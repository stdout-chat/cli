// Session state machine: history, SSE event handling, reconnect loop, and the
// slash commands. All I/O is injected (api, print, config) so it is testable.
import { errorMessage } from './api.js';
import { readEvents } from './sse.js';
import {
  renderLine, renderReactions, renderHide, renderTopic, renderHeader, renderTop,
  renderError, renderInfo, isAddressedTo, MEDALS,
} from './render.js';
import * as defaultConfig from './config.js';
import { NOTIFY_LEVELS } from './notify.js';

export const HINT_NO_KEY = 'type /key sc_… to post · get it in the app: /key';
export const HELP_TEXT = [
  '/help              this list',
  '/r <id> text       reply to a line (ids are the dim column on the left)',
  '/top               this week\'s top authors',
  '/who               how many are in the room',
  '/dm <nick|sid>     invite them to a private chat (accept happens in the app)',
  '/key sc_…          save your key (get it in the app: /key)',
  '/key off           forget the key on this machine (revoke it in the app)',
  '/notify            desktop banners: mentions (default) · all · off',
  '/clear             clear the screen',
  '/quit              leave (Ctrl-C / Ctrl-D work too)',
  'anything else is posted to #void · @nick mentions pass through as typed',
].join('\n');

const MAX_LINES = 1000;
const RECENT = 5;
const MAX_BACKOFF_MS = 30_000;
const NOTICE_AFTER_MS = 5_000;
const STALL_MS = 60_000;

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (!ms || (signal && signal.aborted)) { resolve(); return; }
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); if (signal) signal.removeEventListener('abort', done); resolve(); }
    if (signal) signal.addEventListener('abort', done, { once: true });
  });
}

export function greeting(me) {
  if (!me || !me.username) return null;
  const medal = MEDALS[me.top] ? ` ${MEDALS[me.top]}` : '';
  const rank = me.week && me.week.rank != null ? Number(me.week.rank) : (me.top ? Number(me.top) : null);
  return `you are ${me.username}${medal}${rank ? ` · #${rank} this week` : ''}`;
}

export class Session {
  constructor({
    api,
    print,
    color = true,
    width = () => 80,
    key = null,
    persistApi = null,
    config = defaultConfig,
    n = 30,
    onQuit = () => {},
    onKeyChange = () => {},
    timers = { setTimeout, clearTimeout },
    notify = null,
    notifyLevel = 'mentions',
  }) {
    this.api = api;
    this.print = print;
    this.color = color;
    this.width = width;
    this.key = key;
    this.persistApi = persistApi;
    this.config = config;
    this.n = n;
    this.onQuit = onQuit;
    this.onKeyChange = onKeyChange;
    this.timers = timers;
    // Desktop banner hook: (title, subtitle, body) → void. Null in read/follow
    // modes and when the user opted out, so the session never spawns anything.
    this.notify = typeof notify === 'function' ? notify : null;
    this.notifyLevel = NOTIFY_LEVELS.includes(notifyLevel) ? notifyLevel : 'mentions';

    this.me = null;
    this.topic = null;
    this.count = null;
    this.topWeek = [];
    this.lines = new Map(); // String(id) → message
    this.recent = []; // last printed ids (String)
    this.nickTags = new Map(); // nick → Set(tag)
    this.collisions = new Set();
    this.lastEventId = null;
  }

  ropts() {
    return {
      width: this.width(),
      color: this.color,
      myNick: this.me ? this.me.username : null,
      collisions: this.collisions,
    };
  }

  info(s) { this.print(renderInfo(s, { color: this.color })); }
  error(s) { this.print(renderError(s, { color: this.color })); }

  // ── startup ─────────────────────────────────────────────────────────────

  /**
   * Verifies the stored key via /void/me. Never throws; leaves the key in place on failure.
   * `quiet` swallows the warnings — --tail only needs the nick for mention matching.
   */
  async verifyKey({ quiet = false } = {}) {
    if (!this.key) return null;
    try {
      this.me = await this.api.getMe(this.key);
      return this.me;
    } catch (err) {
      if (quiet) return null;
      if (err && err.status === 401) this.error(`${errorMessage(err)} · /key sc_… to replace it`);
      else this.info(`· couldn't verify key: ${errorMessage(err)}`);
      return null;
    }
  }

  /** GET /void and (optionally) print header + lines. Throws ApiError on failure. */
  async loadHistory({ show = true, n = this.n } = {}) {
    const data = await this.api.getVoid(n);
    this.absorbMeta(data);
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    if (show) {
      this.print(renderHeader({ topic: this.topic, count: this.count }, { color: this.color }));
      if (!msgs.length) this.info('nobody has spoken in the last 24h · the room is not empty. it\'s waiting.');
    }
    for (const m of msgs) this.printMsg(m, { show });
    return data;
  }

  absorbMeta(data) {
    if (!data || typeof data !== 'object') return;
    if (typeof data.topic === 'string') this.topic = data.topic;
    if (data.count != null && Number.isFinite(Number(data.count))) this.count = Number(data.count);
    if (Array.isArray(data.top_week)) this.topWeek = data.top_week;
  }

  greet() {
    if (this.me) this.info(greeting(this.me));
    else if (!this.key) this.info(HINT_NO_KEY);
  }

  // ── lines ───────────────────────────────────────────────────────────────

  ingest(msg) {
    const nick = msg.username == null || msg.username === '' ? 'anon' : String(msg.username);
    const tag = msg.tag == null ? '' : String(msg.tag);
    if (tag) {
      let set = this.nickTags.get(nick);
      if (!set) { set = new Set(); this.nickTags.set(nick, set); }
      set.add(tag);
      if (set.size > 1) this.collisions.add(nick);
    }
    const id = String(msg.id);
    this.lines.set(id, msg);
    if (this.lines.size > MAX_LINES) {
      const oldest = this.lines.keys().next().value;
      this.lines.delete(oldest);
    }
    if (msg.id != null) this.lastEventId = String(msg.id);
  }

  /** Prints a message unless already seen. Returns true when printed. */
  printMsg(msg, { show = true } = {}) {
    if (!msg || typeof msg !== 'object') return false;
    const id = msg.id == null ? null : String(msg.id);
    if (id != null && this.lines.has(id)) return false;
    this.ingest(msg);
    if (!show) return false;
    this.print(renderLine(msg, this.ropts()));
    if (id != null) {
      this.recent.push(id);
      if (this.recent.length > RECENT) this.recent.shift();
    }
    return true;
  }

  /** Handles one SSE event. Returns 'bye' when the server asked us to reconnect. */
  handleEvent(ev) {
    if (!ev) return undefined;
    if (ev.event === 'bye') return 'bye';
    let data;
    try { data = JSON.parse(ev.data); } catch { return undefined; }
    if (!data || typeof data !== 'object') return undefined;
    switch (ev.event) {
      case 'msg':
      case 'message': {
        if (data.id == null && ev.id) data.id = ev.id;
        if (this.printMsg(data)) this.maybeNotify(data); // live lines only: history goes through loadHistory
        break;
      }
      case 'react': {
        const id = String(data.id);
        const m = this.lines.get(id);
        if (!m) break;
        m.reactions = data.reactions;
        if (this.recent.includes(id)) this.print(renderReactions(m, { color: this.color }));
        break;
      }
      case 'hide': {
        const id = String(data.id);
        const m = this.lines.get(id);
        if (m) m.hidden = true;
        const sid = data.sid != null ? data.sid : (m ? m.sid : null);
        if (sid != null) this.print(renderHide(sid, { color: this.color }));
        break;
      }
      case 'topic': {
        if (typeof data.topic === 'string') {
          this.topic = data.topic;
          this.print(renderTopic(data.topic, { color: this.color }));
        }
        break;
      }
      default:
        break; // unknown event types are ignored (forward compatible)
    }
    return undefined;
  }

  /** Desktop banner for a freshly printed live line, per `notifyLevel`. Own lines never notify. */
  maybeNotify(msg) {
    if (!this.notify || this.notifyLevel === 'off') return;
    const myNick = this.me ? this.me.username : null;
    const nick = msg.username == null || msg.username === '' ? 'anon' : String(msg.username);
    if (myNick != null && msg.username === myNick) return;
    const how = isAddressedTo(msg, myNick);
    if (!how && this.notifyLevel !== 'all') return;
    const subtitle = how === 'reply' ? `${nick} → you` : how === 'mention' ? `${nick} @you` : nick;
    this.notify('#void', subtitle, msg.text == null ? '' : String(msg.text));
  }

  // ── stream ──────────────────────────────────────────────────────────────

  /** Runs until `signal` aborts. Backoff 1,2,4…30 s; `bye` → immediate quiet reconnect. */
  async runStream(signal) {
    const { setTimeout: setT, clearTimeout: clearT } = this.timers;
    let attempt = 0;
    let noticeTimer = null;
    let noticed = false;
    let lastErrorShown = null;

    const clearNotice = () => { if (noticeTimer) { clearT(noticeTimer); noticeTimer = null; } };

    while (!signal.aborted) {
      const conn = new AbortController();
      const onAbort = () => conn.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      let bye = false;
      let stall = null;
      try {
        const res = await this.api.openStream({ lastEventId: this.lastEventId, signal: conn.signal });
        attempt = 0;
        lastErrorShown = null;
        clearNotice();
        if (noticed) { this.info('· back'); noticed = false; }
        const kick = () => { if (stall) clearT(stall); stall = setT(() => conn.abort(), STALL_MS); if (stall && stall.unref) stall.unref(); };
        kick();
        for await (const ev of readEvents(res.body, { onChunk: kick })) {
          if (this.handleEvent(ev) === 'bye') { bye = true; break; }
        }
      } catch (err) {
        if (!signal.aborted && !(err && err.name === 'AbortError')) {
          const msg = errorMessage(err);
          if (msg !== lastErrorShown) { this.error(msg); lastErrorShown = msg; }
        }
      } finally {
        if (stall) clearT(stall);
        signal.removeEventListener('abort', onAbort);
      }
      if (signal.aborted) break;
      if (bye) continue;
      if (!noticeTimer && !noticed) {
        noticeTimer = setT(() => { noticeTimer = null; noticed = true; this.info('· reconnecting'); }, NOTICE_AFTER_MS);
        if (noticeTimer && noticeTimer.unref) noticeTimer.unref();
      }
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
      attempt = Math.min(attempt + 1, 10);
      await sleep(delay, signal);
    }
    clearNotice();
  }

  // ── input ───────────────────────────────────────────────────────────────

  async handleInput(raw) {
    const line = String(raw == null ? '' : raw).trim();
    if (!line) return;
    if (line[0] !== '/') { await this.post(line); return; }
    const cmd = line.split(/\s+/, 1)[0].toLowerCase();
    const rest = line.slice(cmd.length).trim();
    switch (cmd) {
      case '/help': case '/h': case '/?':
        this.print(renderInfo(HELP_TEXT, { color: this.color }));
        return;
      case '/quit': case '/q': case '/exit':
        this.onQuit();
        return;
      case '/clear':
        this.onClear && this.onClear();
        return;
      case '/top':
        await this.cmdTop();
        return;
      case '/who':
        await this.cmdWho();
        return;
      case '/dm':
        await this.cmdDm(rest);
        return;
      case '/key':
        await this.cmdKey(rest);
        return;
      case '/notify':
        this.cmdNotify(rest);
        return;
      case '/r': case '/reply': {
        const m = rest.match(/^(\S+)\s+([\s\S]+)$/);
        if (!m) { this.info('usage: /r <id> text'); return; }
        await this.post(m[2].trim(), m[1]);
        return;
      }
      default:
        await this.post(line); // the server owns slash semantics (e.g. 422 command not found)
    }
  }

  async post(text, reply = null) {
    if (!this.key) { this.info(HINT_NO_KEY); return false; }
    try {
      await this.api.post({ text, reply }, this.key); // echo arrives via SSE, not from the response
      return true;
    } catch (err) {
      this.error(errorMessage(err));
      return false;
    }
  }

  async refreshMeta() {
    try { this.absorbMeta(await this.api.getVoid(1)); } catch { /* fall back to cached */ }
  }

  async cmdTop() {
    await this.refreshMeta();
    this.print(renderTop(this.topWeek, { color: this.color }));
  }

  async cmdWho() {
    await this.refreshMeta();
    if (this.count == null) { this.info('no idea · try again'); return; }
    this.info(this.count === 1 ? '1 in room' : `${this.count} in room`);
  }

  /** `/dm <nick|sid>`: a sid seen this session targets that line's author, anything else is a nick. */
  async cmdDm(arg) {
    if (!this.key) { this.info(HINT_NO_KEY); return; }
    if (!arg) { this.info('usage: /dm <nick|sid>'); return; }
    const target = this.isKnownSid(arg) ? { sid: arg } : { nick: arg };
    let res;
    try {
      res = await this.api.dm(target, this.key);
    } catch (err) {
      this.error(errorMessage(err));
      return;
    }
    const to = res && res.to != null && res.to !== '' ? String(res.to) : arg;
    this.info(`invite sent · ${to} has 10 min · you'll get a push when they accept`);
  }

  /** True when `s` is the short id (the dim left column) of a line seen this session. */
  isKnownSid(s) {
    for (const m of this.lines.values()) if (m && m.sid != null && String(m.sid) === s) return true;
    return false;
  }

  async cmdKey(arg) {
    if (!arg) {
      if (this.me) this.info(greeting(this.me));
      else if (this.key) this.info('a key is on file but not verified · /key sc_… to replace it');
      else this.info('no key · get it in the app: /key');
      return;
    }
    if (arg.toLowerCase() === 'off') {
      this.config.removeConfig();
      this.key = null;
      this.me = null;
      this.onKeyChange(null);
      this.info('key removed from this machine · to revoke it, run /key off in the app');
      return;
    }
    if (!/^sc_[A-Za-z0-9]+$/.test(arg)) {
      this.info('usage: /key sc_…  ·  /key off');
      return;
    }
    let me;
    try {
      me = await this.api.getMe(arg);
    } catch (err) {
      this.error(errorMessage(err));
      return;
    }
    this.key = arg;
    this.me = me;
    try {
      this.config.saveConfig({ key: arg, api: this.persistApi || undefined, notify: this.notifyLevel });
    } catch (err) {
      this.error(`saved in memory only · ${errorMessage(err)}`);
    }
    this.onKeyChange(arg);
    this.info(greeting(me) || 'key saved');
  }

  cmdNotify(arg) {
    if (!arg) {
      this.info(`notifications: ${this.notifyLevel}`);
      return;
    }
    const level = arg.toLowerCase();
    if (!NOTIFY_LEVELS.includes(level)) {
      this.info('usage: /notify mentions · /notify all · /notify off');
      return;
    }
    this.notifyLevel = level;
    try {
      // The key stays as it is; only the level changes. No key → no file is written
      // for the key twin, but the level still persists in config.json.
      this.config.saveConfig({ key: this.key || undefined, api: this.persistApi || undefined, notify: level });
    } catch (err) {
      this.error(`set for this session only · ${errorMessage(err)}`);
      return;
    }
    this.info(`notifications: ${level}`);
  }
}
