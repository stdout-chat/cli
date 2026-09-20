import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, HINT_NO_KEY } from '../lib/session.js';
import { ApiError } from '../lib/api.js';

const msg = (id, extra = {}) => ({ id, sid: `a${id.toString(36).padStart(3, '0')}`, username: 'kira', tag: 'c31d', text: `line ${id}`, ...extra });
const ev = (event, data, id) => ({ event, id: id == null ? '' : String(id), data: JSON.stringify(data) });

function make({ key = null, api = {} } = {}) {
  const out = [];
  const cfg = { saved: null, removed: 0, saveConfig(c) { cfg.saved = c; }, removeConfig() { cfg.removed++; } };
  const fake = {
    calls: [],
    async getVoid(n) { fake.calls.push(['getVoid', n]); return api.getVoid ? api.getVoid(n) : { topic: 'sounds', count: 3, top_week: [{ nick: 'kira', rank: 1 }], messages: [msg(1), msg(2)] }; },
    async getMe(k) { fake.calls.push(['getMe', k]); if (api.getMe) return api.getMe(k); if (k === 'sc_good') return { username: 'kira', tag: 'c31d', week: { rank: 4 } }; throw new ApiError('key revoked · /key new in the app', { status: 401 }); },
    async post(body, k) { fake.calls.push(['post', body, k]); if (api.post) return api.post(body, k); return { id: 99 }; },
    async openStream(o) { fake.calls.push(['openStream', o]); return api.openStream(o); },
  };
  let quit = 0;
  const s = new Session({ api: fake, print: (l) => out.push(l), color: false, width: () => 80, key, config: cfg, persistApi: 'http://stand', onQuit: () => quit++ });
  return { s, out, fake, cfg, quitCount: () => quit };
}

test('history: header, lines, dedupe, lastEventId, greeting hint without key', async () => {
  const { s, out } = make();
  await s.loadHistory();
  s.greet();
  assert.equal(out[0], '#void · sounds · 3 in room');
  assert.equal(out[1], 'a001  kira         line 1');
  assert.equal(out[2], 'a002  kira         line 2');
  assert.equal(out[3], HINT_NO_KEY);
  assert.equal(s.lastEventId, '2');
  assert.equal(s.printMsg(msg(2)), false, 'duplicate ids are not reprinted');
  assert.equal(out.length, 4);
});

test('SSE events: msg prints, react reprints only for recent lines, hide, topic, bye, unknown', async () => {
  const { s, out } = make();
  await s.loadHistory();
  out.length = 0;
  assert.equal(s.handleEvent(ev('msg', msg(3), 3)), undefined);
  assert.equal(out.pop(), 'a003  kira         line 3');
  assert.equal(s.lastEventId, '3');
  s.handleEvent(ev('react', { id: 3, reactions: [['❤️', 2]] }));
  assert.equal(out.pop(), 'a003  ❤️ 2');
  assert.equal(s.lines.get('3').reactions[0][1], 2);
  for (let i = 4; i <= 9; i++) s.handleEvent(ev('msg', msg(i), i));
  out.length = 0;
  s.handleEvent(ev('react', { id: 3, reactions: [['❤️', 5]] }));
  assert.equal(out.length, 0, 'react on a line older than the last 5 is stored silently');
  assert.equal(s.lines.get('3').reactions[0][1], 5);
  s.handleEvent(ev('react', { id: 777, reactions: [] }));
  s.handleEvent(ev('hide', { id: 3 }));
  assert.equal(out.pop(), 'a003  ↳ message removed');
  s.handleEvent(ev('hide', { id: 12345 }));
  assert.equal(out.length, 0, 'hide for an unknown line without sid prints nothing');
  s.handleEvent(ev('topic', { topic: 'silence' }));
  assert.equal(out.pop(), '// topic: silence');
  assert.equal(s.topic, 'silence');
  assert.equal(s.handleEvent({ event: 'bye', id: '', data: '{}' }), 'bye');
  assert.equal(s.handleEvent(ev('something_new', { x: 1 })), undefined);
  assert.equal(s.handleEvent({ event: 'msg', id: '', data: 'not json' }), undefined);
  assert.equal(out.length, 0);
});

test('msg without id in data takes the SSE id line', () => {
  const { s } = make();
  s.handleEvent({ event: 'msg', id: '55', data: JSON.stringify({ sid: 'zz', text: 'x' }) });
  assert.equal(s.lastEventId, '55');
  assert.ok(s.lines.has('55'));
});

test('nick·tag appears once two tags share a nick this session', () => {
  const { s, out } = make();
  s.printMsg(msg(1, { username: 'sam', tag: 'aaaa' }));
  s.printMsg(msg(2, { username: 'sam', tag: 'bbbb' }));
  assert.equal(out[0], 'a001  sam          line 1');
  assert.equal(out[1], 'a002  sam·bbbb     line 2');
});

test('input: empty ignored, post without key hints, post with key hits api and does not echo', async () => {
  const { s, out, fake } = make();
  await s.handleInput('   ');
  assert.equal(out.length, 0);
  await s.handleInput('hello');
  assert.equal(out.pop(), HINT_NO_KEY);
  s.key = 'sc_good';
  await s.handleInput('hello @mox');
  assert.deepEqual(fake.calls.at(-1), ['post', { text: 'hello @mox', reply: null }, 'sc_good']);
  assert.equal(out.length, 0, 'no local echo');
});

test('input: /r reply, usage, server error printed verbatim', async () => {
  const { s, out, fake } = make({ key: 'sc_good', api: { post(body) { if (body.reply === 'dead') throw new ApiError('reply target gone', { status: 404 }); return { id: 1 }; } } });
  await s.handleInput('/r a1b2 yes exactly');
  assert.deepEqual(fake.calls.at(-1), ['post', { text: 'yes exactly', reply: 'a1b2' }, 'sc_good']);
  await s.handleInput('/r a1b2');
  assert.equal(out.pop(), 'usage: /r <id> text');
  await s.handleInput('/r dead hi');
  assert.equal(out.pop(), 'reply target gone');
});

test('input: unknown slash goes to the server; /help, /quit, /top, /who', async () => {
  const { s, out, fake, quitCount } = make({ key: 'sc_good' });
  await s.handleInput('/dance');
  assert.deepEqual(fake.calls.at(-1), ['post', { text: '/dance', reply: null }, 'sc_good']);
  await s.handleInput('/help');
  assert.match(out.pop(), /\/r <id> text/);
  await s.handleInput('/top');
  assert.equal(out.pop(), '#1 kira 👑');
  await s.handleInput('/who');
  assert.equal(out.pop(), '3 in room');
  await s.handleInput('/quit');
  assert.equal(quitCount(), 1);
});

test('/key flows: status, bad format, invalid key, valid key saves + greets, off removes', async () => {
  const { s, out, cfg } = make();
  await s.handleInput('/key');
  assert.equal(out.pop(), 'no key · get it in the app: /key');
  await s.handleInput('/key nope');
  assert.equal(out.pop(), 'usage: /key sc_…  ·  /key off');
  await s.handleInput('/key sc_bad');
  assert.equal(out.pop(), 'key revoked · /key new in the app');
  assert.equal(s.key, null);
  await s.handleInput('/key sc_good');
  assert.equal(out.pop(), 'you are kira · #4 this week');
  assert.equal(s.key, 'sc_good');
  assert.deepEqual(cfg.saved, { key: 'sc_good', api: 'http://stand', notify: 'mentions' });
  await s.handleInput('/key');
  assert.equal(out.pop(), 'you are kira · #4 this week');
  await s.handleInput('/key off');
  assert.equal(cfg.removed, 1);
  assert.equal(s.key, null);
  assert.match(out.pop(), /^key removed from this machine/);
});

test('verifyKey: 401 keeps the key but warns; network error warns softly', async () => {
  const a = make({ key: 'sc_bad' });
  assert.equal(await a.s.verifyKey(), null);
  assert.equal(a.s.key, 'sc_bad');
  assert.match(a.out.pop(), /^key revoked · \/key new in the app · \/key sc_… to replace it$/);
  const b = make({ key: 'sc_x', api: { getMe() { throw new ApiError('network error · ECONNREFUSED'); } } });
  await b.s.verifyKey();
  assert.equal(b.out.pop(), "· couldn't verify key: network error · ECONNREFUSED");
});

function sseBody(frames) {
  return new ReadableStream({ start(c) { for (const f of frames) c.enqueue(new TextEncoder().encode(f)); c.close(); } });
}

test('runStream: consumes events, sends Last-Event-ID, reconnects after bye immediately, stops on abort', async () => {
  let n = 0;
  const stop = new AbortController();
  const { s, out, fake } = make({ api: {
    openStream() {
      n++;
      if (n === 1) return new Response(sseBody([`event: msg\nid: 10\ndata: ${JSON.stringify(msg(10))}\n\n`, 'event: bye\ndata: {}\n\n']), { status: 200 });
      if (n === 2) return new Response(sseBody([`event: msg\nid: 11\ndata: ${JSON.stringify(msg(11))}\n\n`]), { status: 200 });
      stop.abort();
      const e = new Error('aborted'); e.name = 'AbortError'; throw e;
    },
  } });
  await s.runStream(stop.signal);
  assert.equal(n, 3);
  assert.equal(fake.calls[0][1].lastEventId, null);
  assert.equal(fake.calls[1][1].lastEventId, '10');
  assert.equal(fake.calls[2][1].lastEventId, '11');
  assert.deepEqual(out, ['a00a  kira         line 10', 'a00b  kira         line 11']);
});

test('runStream: 503 body printed once per outage, backoff via injected timers, "· reconnecting" after 5s', async () => {
  const delays = [];
  const timers = { setTimeout(fn, ms) { delays.push(ms); if (ms === 5000) fn(); return { unref() {} }; }, clearTimeout() {} };
  let n = 0;
  const stop = new AbortController();
  const { s, out } = make({ api: {
    openStream() {
      n++;
      if (n <= 3) throw new ApiError('too many watchers · try curl https://stdout.chat/void', { status: 503 });
      stop.abort();
      const e = new Error('aborted'); e.name = 'AbortError'; throw e;
    },
  } });
  s.timers = timers;
  // sleep() uses the real setTimeout; make the waits instant by aborting the wait through a tiny delay
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms > 50 ? 1 : ms, ...rest);
  try { await s.runStream(stop.signal); } finally { globalThis.setTimeout = realSetTimeout; }
  assert.equal(n, 4);
  assert.deepEqual(out, ['too many watchers · try curl https://stdout.chat/void', '· reconnecting']);
  assert.deepEqual(delays.filter((d) => d === 5000).length, 1);
});

// ── notifications ────────────────────────────────────────────────────────

function makeNotifying(opts = {}) {
  const r = make({ key: 'sc_good', ...opts });
  r.banners = [];
  r.s.notify = (title, subtitle, body) => r.banners.push([title, subtitle, body]);
  r.s.me = { username: 'kira', tag: 'c31d' };
  return r;
}

test('notify: a live reply to me → one banner "nick → you"; @me → "nick @you"', () => {
  const { s, banners } = makeNotifying();
  s.handleEvent(ev('msg', msg(10, { username: 'mox', text: 'yes, exactly', reply: { username: 'kira', text: 'line 1' } }), 10));
  assert.deepEqual(banners, [['#void', 'mox → you', 'yes, exactly']]);
  s.handleEvent(ev('msg', msg(10, { username: 'mox', text: 'dup', reply: { username: 'kira' } }), 10));
  assert.equal(banners.length, 1, 'a replayed id neither prints nor notifies');
  s.handleEvent(ev('msg', msg(11, { username: 'mox', text: 'hey @Kira, fans' }), 11));
  assert.deepEqual(banners.at(-1), ['#void', 'mox @you', 'hey @Kira, fans']);
});

test('notify: own lines never; unaddressed lines only at level all; off silences everything', () => {
  const { s, banners } = makeNotifying();
  s.handleEvent(ev('msg', msg(20, { username: 'kira', text: 'talking to myself @kira' }), 20));
  s.handleEvent(ev('msg', msg(21, { username: 'kira', text: 'reply to me', reply: { username: 'kira' } }), 21));
  assert.equal(banners.length, 0, 'own lines');
  s.handleEvent(ev('msg', msg(22, { username: 'mox', text: 'ceiling fans' }), 22));
  assert.equal(banners.length, 0, 'unaddressed at mentions');
  s.notifyLevel = 'all';
  s.handleEvent(ev('msg', msg(23, { username: 'mox', text: 'ceiling fans again' }), 23));
  assert.deepEqual(banners.at(-1), ['#void', 'mox', 'ceiling fans again']);
  s.handleEvent(ev('msg', msg(24, { username: '', tag: 'zz9', text: 'from nowhere' }), 24));
  assert.deepEqual(banners.at(-1), ['#void', 'anon', 'from nowhere']);
  s.handleEvent(ev('msg', msg(25, { username: 'kira', text: 'still me' }), 25));
  assert.equal(banners.length, 2, 'own lines stay silent at all');
  s.notifyLevel = 'off';
  s.handleEvent(ev('msg', msg(26, { username: 'mox', text: '@kira ping', reply: { username: 'kira' } }), 26));
  assert.equal(banners.length, 2, 'off');
});

test('notify: history at startup never notifies, even when it replies to me', async () => {
  const r = makeNotifying({ api: { getVoid: () => ({ messages: [msg(1, { username: 'mox', text: '@kira hi', reply: { username: 'kira' } })] }) } });
  await r.s.loadHistory();
  assert.equal(r.banners.length, 0);
  r.s.handleEvent(ev('msg', msg(2, { username: 'mox', text: '@kira now live' }), 2));
  assert.equal(r.banners.length, 1);
});

test('notify: without a nick (no key in --tail), mentions cannot match but all still works', () => {
  const r = makeNotifying({ key: null });
  r.s.me = null;
  r.s.handleEvent(ev('msg', msg(30, { username: 'mox', text: '@kira?', reply: { username: 'kira' } }), 30));
  assert.equal(r.banners.length, 0);
  r.s.notifyLevel = 'all';
  r.s.handleEvent(ev('msg', msg(31, { username: 'mox', text: 'anyone' }), 31));
  assert.deepEqual(r.banners, [['#void', 'mox', 'anyone']]);
});

test('notify: no hook injected (read / follow modes) → nothing happens at any level', () => {
  const { s, out } = make({ key: 'sc_good' });
  s.me = { username: 'kira' };
  s.notifyLevel = 'all';
  s.handleEvent(ev('msg', msg(40, { username: 'mox', text: '@kira', reply: { username: 'kira' } }), 40));
  assert.equal(out.length, 1, 'line printed, no crash');
});

test('/notify: shows the level, validates, persists via saveConfig, /key keeps the level', async () => {
  const { s, out, cfg, banners } = makeNotifying();
  await s.handleInput('/notify');
  assert.equal(out.pop(), 'notifications: mentions');
  await s.handleInput('/notify loud');
  assert.equal(out.pop(), 'usage: /notify mentions · /notify all · /notify off');
  assert.equal(cfg.saved, null);
  await s.handleInput('/notify OFF');
  assert.equal(out.pop(), 'notifications: off');
  assert.equal(s.notifyLevel, 'off');
  assert.deepEqual(cfg.saved, { key: 'sc_good', api: 'http://stand', notify: 'off' });
  s.handleEvent(ev('msg', msg(50, { username: 'mox', text: '@kira', reply: { username: 'kira' } }), 50));
  assert.equal(banners.length, 0);
  await s.handleInput('/key sc_good');
  assert.deepEqual(cfg.saved, { key: 'sc_good', api: 'http://stand', notify: 'off' }, '/key does not reset the level');
  await s.handleInput('/notify all');
  assert.deepEqual(cfg.saved, { key: 'sc_good', api: 'http://stand', notify: 'all' });
  s.handleEvent(ev('msg', msg(51, { username: 'mox', text: 'anything' }), 51));
  assert.equal(banners.length, 1);
  await s.handleInput('/help');
  assert.match(out.pop(), /\/notify/);
});

test('/notify without a key persists the level alone; a failing save is reported softly', async () => {
  const a = makeNotifying({ key: null });
  a.s.key = null;
  await a.s.handleInput('/notify all');
  assert.deepEqual(a.cfg.saved, { key: undefined, api: 'http://stand', notify: 'all' });
  const b = makeNotifying();
  b.cfg.saveConfig = () => { throw new Error('EROFS: read-only'); };
  await b.s.handleInput('/notify off');
  assert.equal(b.s.notifyLevel, 'off', 'the session honours the level even when the disk refuses');
  assert.match(b.out.pop(), /^set for this session only · /);
});

test('verifyKey({ quiet }) stays silent on 401 and network errors', async () => {
  const a = make({ key: 'sc_bad' });
  assert.equal(await a.s.verifyKey({ quiet: true }), null);
  assert.equal(a.out.length, 0);
  assert.equal(a.s.key, 'sc_bad');
  const b = make({ key: 'sc_good' });
  assert.equal((await b.s.verifyKey({ quiet: true })).username, 'kira');
  assert.equal(b.out.length, 0);
});
