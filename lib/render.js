// Pure line rendering: message object → string. No I/O, no process access.
// Layout (mirrors the app / the text mode of GET /void):
//
//   a1b4  mox 👑       → kira  ceiling fans, obviously  ❤️ 2 😂 1
//         ↳ the hum of a fridge at 3am
//   ^sid  ^nick(12)    ^text column, wrapped with a hanging indent

export const CSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  brightGreen: '\x1b[92m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dimRed: '\x1b[2;31m',
};

export const SID_W = 5;
export const NICK_W = 12;
export const TEXT_COL = SID_W + 1 + NICK_W + 1; // 19
export const QUOTE_MAX = 90;
export const MEDALS = { 1: '👑', 2: '🥈', 3: '🥉' };

/** Returns a paint(str, ...codes) function; identity when colour is off. */
export function painter(color) {
  if (!color) return (s) => s;
  return (s, ...codes) => (codes.length ? codes.join('') + s + CSI.reset : s);
}

function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f680 && cp <= 0x1f6ff) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x1fa70 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd) ||
    cp === 0x231a || cp === 0x231b || (cp >= 0x23e9 && cp <= 0x23ec) || cp === 0x23f0 || cp === 0x23f3 ||
    (cp >= 0x25fd && cp <= 0x25fe) || (cp >= 0x2614 && cp <= 0x2615) || (cp >= 0x2648 && cp <= 0x2653) ||
    cp === 0x267f || cp === 0x2693 || cp === 0x26a1 || (cp >= 0x26aa && cp <= 0x26ab) ||
    (cp >= 0x26bd && cp <= 0x26be) || (cp >= 0x26c4 && cp <= 0x26c5) || cp === 0x26ce || cp === 0x26d4 ||
    cp === 0x26ea || (cp >= 0x26f2 && cp <= 0x26f3) || cp === 0x26f5 || cp === 0x26fa || cp === 0x26fd ||
    cp === 0x2705 || (cp >= 0x270a && cp <= 0x270b) || cp === 0x2728 || cp === 0x274c || cp === 0x274e ||
    (cp >= 0x2753 && cp <= 0x2755) || cp === 0x2757 || (cp >= 0x2795 && cp <= 0x2797) || cp === 0x27b0 ||
    cp === 0x27bf || (cp >= 0x2b1b && cp <= 0x2b1c) || cp === 0x2b50 || cp === 0x2b55
  );
}

function isZeroWidth(cp) {
  return (
    cp === 0x200d || cp === 0xfe0e || cp === 0x20e3 ||
    (cp >= 0x300 && cp <= 0x36f) ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
    (cp >= 0xe0020 && cp <= 0xe007f) ||
    cp < 0x20 || (cp >= 0x7f && cp < 0xa0)
  );
}

/** Terminal cell width of a string (best effort: CJK/emoji = 2, VS16 promotes, ZWJ joins). */
export function displayWidth(str) {
  let w = 0;
  let prev = 0;
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfe0f) {
      // Variation selector 16: a narrow symbol rendered as emoji becomes wide.
      if (prev >= 0x2000 && prev <= 0x2bff && !isWide(prev)) w += 1;
      prev = cp;
      continue;
    }
    if (isZeroWidth(cp) || prev === 0x200d) { prev = cp; continue; }
    w += isWide(cp) ? 2 : 1;
    prev = cp;
  }
  return w;
}

/** Pad on the right with spaces to `n` display cells (never truncates). */
export function padTo(str, n) {
  const w = displayWidth(str);
  return w >= n ? str : str + ' '.repeat(n - w);
}

/** Cut a string to at most `n` cells, appending '…' when cut. */
export function truncate(str, n) {
  if (displayWidth(str) <= n) return str;
  let out = '';
  let w = 0;
  for (const ch of str) {
    const cw = displayWidth(ch);
    if (w + cw > n - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

function splitAt(word, n) {
  let head = '';
  let w = 0;
  let i = 0;
  for (const ch of word) {
    const cw = displayWidth(ch);
    if (w + cw > n) break;
    head += ch;
    w += cw;
    i += ch.length;
  }
  if (!head) { // pathological: first char wider than the line
    const ch = String.fromCodePoint(word.codePointAt(0));
    return [ch, word.slice(ch.length)];
  }
  return [head, word.slice(i)];
}

/** Greedy word wrap by display width. First line gets `first` cells, the rest `rest`. */
export function wrap(text, first, rest = first) {
  const out = [];
  let cur = '';
  let curW = 0;
  let avail = Math.max(first, 8);
  const flush = () => { out.push(cur); cur = ''; curW = 0; avail = Math.max(rest, 8); };
  for (let word of String(text).split(/\s+/).filter(Boolean)) {
    for (;;) {
      const ww = displayWidth(word);
      const need = curW ? curW + 1 + ww : ww;
      if (need <= avail) {
        cur = curW ? `${cur} ${word}` : word;
        curW = need;
        break;
      }
      if (curW) { flush(); continue; }
      const [head, tail] = splitAt(word, avail);
      cur = head;
      curW = displayWidth(head);
      flush();
      word = tail;
      if (!word) break;
    }
  }
  if (cur || out.length === 0) out.push(cur);
  return out;
}

/** `nick·tag` only when the nick collides with another tag this session, or for anon. */
export function displayNick(msg, collisions) {
  const nick = msg.username == null || msg.username === '' ? 'anon' : String(msg.username);
  const tag = msg.tag == null ? '' : String(msg.tag);
  if (tag && (nick === 'anon' || (collisions && collisions.has(nick)))) return `${nick}·${tag}`;
  return nick;
}

/** `[["❤️",2],["😂",1]]` or `{"❤️":2}` → `❤️ 2 😂 1`. Unknown shapes → ''. */
export function formatReactions(reactions) {
  if (!reactions) return '';
  const pairs = Array.isArray(reactions) ? reactions : (typeof reactions === 'object' ? Object.entries(reactions) : []);
  return pairs
    .filter((p) => Array.isArray(p) && p.length >= 2 && Number(p[1]) > 0)
    .map(([emoji, n]) => `${emoji} ${Number(n)}`)
    .join(' ');
}

function oneLine(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/**
 * Render one message. opts: { width=80, color=true, myNick=null, collisions=null }.
 * Returns a string that may contain newlines (wrap + quote line).
 */
export function renderLine(msg, opts = {}) {
  const { width = 80, color = true, myNick = null, collisions = null } = opts;
  const p = painter(color);
  const own = myNick != null && msg.username === myNick;

  const sid = padTo(String(msg.sid == null ? '' : msg.sid), SID_W);
  const nickText = displayNick(msg, collisions);
  const medal = MEDALS[msg.top] ? ` ${MEDALS[msg.top]}` : '';
  const nickPad = ' '.repeat(Math.max(0, NICK_W - displayWidth(nickText + medal)));
  const head = `${p(sid, CSI.dim)} ${p(nickText, ...(own ? [CSI.bold, CSI.brightGreen] : [CSI.green]))}${medal}${nickPad} `;

  const avail = Math.max(width - TEXT_COL, 10);
  const reply = msg.reply && typeof msg.reply === 'object' ? msg.reply : null;
  const prefix = reply ? `→ ${oneLine(reply.username) || 'anon'}  ` : '';
  const prefixW = displayWidth(prefix);
  const lines = wrap(oneLine(msg.text), avail - prefixW, avail);
  const indent = ' '.repeat(TEXT_COL);

  const out = lines.map((l, i) => {
    const body = own ? p(l, CSI.bold) : l;
    return i === 0 ? `${head}${prefix ? p(prefix, CSI.dim) : ''}${body}` : `${indent}${body}`;
  });

  const reactions = formatReactions(msg.reactions);
  if (reactions) {
    const lastW = (lines.length === 1 ? prefixW : 0) + displayWidth(lines[lines.length - 1]);
    if (lastW + 2 + displayWidth(reactions) <= avail) out[out.length - 1] += `  ${p(reactions, CSI.dim)}`;
    else out.push(`${indent}${p(reactions, CSI.dim)}`);
  }

  if (reply) {
    const quote = reply.gone ? '(gone)' : truncate(oneLine(reply.text), QUOTE_MAX);
    out.push(`${' '.repeat(SID_W + 1)}${p(`↳ ${quote}`, CSI.dim)}`);
  }
  return out.join('\n');
}

/** Dim one-liner printed when a recent line's reactions change. */
export function renderReactions(msg, opts = {}) {
  const p = painter(opts.color !== false);
  const sid = padTo(String(msg.sid == null ? '' : msg.sid), SID_W);
  return p(`${sid} ${formatReactions(msg.reactions) || '·'}`, CSI.dim);
}

export function renderHide(sid, opts = {}) {
  const p = painter(opts.color !== false);
  return p(`${padTo(String(sid == null ? '' : sid), SID_W)} ↳ message removed`, CSI.dim);
}

export function renderTopic(topic, opts = {}) {
  const p = painter(opts.color !== false);
  return p(`// topic: ${oneLine(topic)}`, CSI.cyan);
}

export function renderHeader({ topic, count } = {}, opts = {}) {
  const p = painter(opts.color !== false);
  const parts = [p('#void', CSI.green)];
  if (topic) parts.push(oneLine(topic));
  if (count != null) parts.push(`${Number(count)} in room`);
  return parts.join(' · ');
}

export function renderTop(topWeek, opts = {}) {
  const p = painter(opts.color !== false);
  const list = Array.isArray(topWeek) ? topWeek.filter((t) => t && t.nick) : [];
  if (!list.length) return p('no top this week yet', CSI.dim);
  return list
    .map((t, i) => {
      const rank = Number(t.rank) || i + 1;
      const medal = MEDALS[rank] ? ` ${MEDALS[rank]}` : '';
      return `${p(`#${rank}`, CSI.dim)} ${p(String(t.nick), CSI.green)}${medal}`;
    })
    .join('\n');
}

export function renderError(message, opts = {}) {
  const p = painter(opts.color !== false);
  return p(oneLine(message), CSI.dimRed);
}

export function renderInfo(message, opts = {}) {
  const p = painter(opts.color !== false);
  return p(String(message), CSI.dim);
}
