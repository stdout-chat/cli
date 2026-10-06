import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderLine, renderReactions, renderHide, renderTopic, renderTop, renderHeader,
  displayWidth, wrap, truncate, formatReactions, displayNick, isAddressedTo, formatTime, CSI,
} from '../lib/render.js';

process.env.TZ = 'UTC'; // the time column is local time; pin the zone so HH:MM is stable

const plain = { color: false, width: 80 };
const base = { id: 1, sid: 'a1b2', username: 'kira', tag: 'c31d', text: 'the hum of a fridge at 3am', ts: 1758285900 }; // 2025-09-19T12:45:00Z

test('displayWidth: ascii, emoji, VS16, CJK, ZWJ', () => {
  assert.equal(displayWidth('kira'), 4);
  assert.equal(displayWidth('👑'), 2);
  assert.equal(displayWidth('❤️'), 2);
  assert.equal(displayWidth('❤'), 1);
  assert.equal(displayWidth('日本'), 4);
  assert.equal(displayWidth('👨‍👩‍👧'), 2);
  assert.equal(displayWidth('mox 👑'), 6);
});

test('plain line: time column, nick padded to 12, text', () => {
  assert.equal(renderLine(base, plain), '12:45  kira         the hum of a fridge at 3am');
});

test('reply: → nick prefix and dim quote line under the nick column', () => {
  const msg = { ...base, id: 2, sid: 'a1b4', username: 'mox', tag: '9f2e', text: 'ceiling fans, obviously',
    reply: { username: 'kira', text: 'the hum of a fridge at 3am', gone: false } };
  assert.equal(renderLine(msg, plain), [
    '12:45  mox          → kira  ceiling fans, obviously',
    '       ↳ the hum of a fridge at 3am',
  ].join('\n'));
});

test('reply to a hidden parent shows ↳ (gone)', () => {
  const msg = { ...base, reply: { username: 'mox', text: '', gone: true } };
  assert.equal(renderLine(msg, plain), [
    '12:45  kira         → mox  the hum of a fridge at 3am',
    '       ↳ (gone)',
  ].join('\n'));
});

test('quote is cut at 90 cells with an ellipsis', () => {
  const long = 'x'.repeat(120);
  const msg = { ...base, reply: { username: 'mox', text: long } };
  const quote = renderLine(msg, plain).split('\n')[1];
  assert.equal(quote, `       ↳ ${'x'.repeat(89)}…`);
  assert.equal(displayWidth(quote.slice(9)), 90);
});

test('reactions follow the text; crown and medals follow the nick', () => {
  const msg = { ...base, top: 1, reactions: [['❤️', 2], ['😂', 1]] };
  assert.equal(renderLine(msg, plain), '12:45  kira 👑      the hum of a fridge at 3am  ❤️ 2 😂 1');
  assert.equal(renderLine({ ...base, top: 2 }, plain), '12:45  kira 🥈      the hum of a fridge at 3am');
  assert.equal(renderLine({ ...base, top: 3 }, plain), '12:45  kira 🥉      the hum of a fridge at 3am');
  assert.equal(formatReactions({ '👀': 4 }), '👀 4');
  assert.equal(formatReactions([['❤️', 0]]), '');
  assert.equal(formatReactions(null), '');
});

test('reactions spill to their own line when they do not fit', () => {
  const msg = { ...base, text: 'w'.repeat(58), reactions: [['❤️', 2]] };
  assert.equal(renderLine(msg, plain), [
    `12:45  kira         ${'w'.repeat(58)}`,
    `${' '.repeat(20)}❤️ 2`,
  ].join('\n'));
});

test('wrap at terminal width with a hanging indent under the text column', () => {
  const msg = { ...base, text: 'one two three four five six seven eight nine ten eleven twelve' };
  const out = renderLine(msg, { color: false, width: 40 });
  assert.equal(out, [
    '12:45  kira         one two three four',
    '                    five six seven eight',
    '                    nine ten eleven',
    '                    twelve',
  ].join('\n'));
  for (const l of out.split('\n')) assert.ok(displayWidth(l) <= 40, l);
});

test('wrap: reply prefix shortens only the first line; very long words are hard-broken', () => {
  assert.deepEqual(wrap('abcdefghijklmnopqrstuvwxyz', 10, 10), ['abcdefghij', 'klmnopqrst', 'uvwxyz']);
  assert.deepEqual(wrap('', 10), ['']);
  const msg = { ...base, text: 'alpha beta gamma delta', reply: { username: 'mox', text: 'q' } };
  const out = renderLine(msg, { color: false, width: 40 });
  assert.equal(out.split('\n')[0], '12:45  kira         → mox  alpha beta');
  assert.equal(out.split('\n')[1], '                    gamma delta');
});

test('nick·tag only for anon or a collision; anon without tag stays anon', () => {
  assert.equal(displayNick({ username: 'anon', tag: 'c31d' }), 'anon·c31d');
  assert.equal(displayNick({ username: 'kira', tag: 'c31d' }, new Set()), 'kira');
  assert.equal(displayNick({ username: 'kira', tag: 'c31d' }, new Set(['kira'])), 'kira·c31d');
  assert.equal(displayNick({ username: '', tag: '' }), 'anon');
  assert.equal(renderLine({ ...base, username: 'anon' }, plain), '12:45  anon·c31d    the hum of a fridge at 3am');
});

test('colours: nick green, own nick bright+bold, time/quote/reactions dim, none with color=false', () => {
  const msg = { ...base, reactions: [['❤️', 1]], reply: { username: 'mox', text: 'q' } };
  const out = renderLine(msg, { color: true, width: 80 });
  assert.ok(out.includes(`${CSI.dim}12:45${CSI.reset}  `));
  assert.ok(out.includes(`${CSI.green}kira${CSI.reset}`));
  assert.ok(out.includes(`${CSI.dim}→ mox  ${CSI.reset}`));
  assert.ok(out.includes(`${CSI.dim}❤️ 1${CSI.reset}`));
  assert.ok(out.includes(`${CSI.dim}↳ q${CSI.reset}`));
  const own = renderLine(msg, { color: true, width: 80, myNick: 'kira' });
  assert.ok(own.includes(`${CSI.bold}${CSI.brightGreen}kira${CSI.reset}`));
  assert.ok(own.includes(`${CSI.bold}the hum of a fridge at 3am${CSI.reset}`));
  assert.ok(!renderLine(msg, plain).includes('\x1b['));
  assert.ok(!renderLine(msg, { ...plain, myNick: 'kira' }).includes('\x1b['));
});

test('status renderers', () => {
  assert.equal(renderReactions({ ts: 1758285900, reactions: [['❤️', 3]] }, { color: false }), '12:45  ❤️ 3');
  assert.equal(renderHide({ ts: 1758285900 }, { color: false }), '12:45  ↳ message removed');
  assert.equal(renderHide(null, { color: false }), '       ↳ message removed');
  assert.equal(renderTopic('silence', { color: false }), '// topic: silence');
  assert.equal(renderHeader({ topic: 't', count: 3 }, { color: false }), '#void · t · 3 in room');
  assert.equal(renderTop([{ nick: 'kira', rank: 1 }, { nick: 'mox', rank: 2 }], { color: false }), '#1 kira 👑\n#2 mox 🥈');
  assert.equal(renderTop([], { color: false }), 'no top this week yet');
  assert.equal(truncate('abc', 3), 'abc');
  assert.equal(truncate('abcd', 3), 'ab…');
});

test('tolerates missing/extra fields', () => {
  assert.equal(renderLine({ text: 'x', extra: { deep: true } }, plain), '       anon         x');
  assert.equal(renderLine({ ts: 'soon', username: 'a', text: '  multi\n line  ', reactions: 'nope' }, plain), '       a            multi line');
});

test('formatTime: HH:MM in the local zone from ISO 8601 (the API), unix seconds or ms; blanks when missing or junk', () => {
  assert.equal(formatTime('2025-09-19T12:45:00.000Z'), '12:45', 'what the API sends');
  assert.equal(formatTime('2025-09-19T12:45:07Z'), '12:45');
  assert.equal(formatTime(1758285900000), '12:45', 'milliseconds');
  assert.equal(formatTime(1758285900), '12:45');
  assert.equal(formatTime('1758285900'), '12:45');
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(1758240000 + 9 * 60), '00:09', 'zero-padded');
  assert.equal(formatTime(null), '     ');
  assert.equal(formatTime(undefined), '     ');
  assert.equal(formatTime(''), '     ');
  assert.equal(formatTime('soon'), '     ');
});

test('isAddressedTo: reply to me, @nick at start / middle / with punctuation, case-insensitive', () => {
  const m = (text, reply) => ({ ...base, username: 'mox', text, ...(reply ? { reply } : {}) });
  assert.equal(isAddressedTo(m('sure', { username: 'kira', text: 'x' }), 'kira'), 'reply');
  assert.equal(isAddressedTo(m('sure', { username: 'KIRA' }), 'kira'), 'reply');
  assert.equal(isAddressedTo(m('sure', { username: 'mox' }), 'kira'), null);
  assert.equal(isAddressedTo(m('@kira yes'), 'kira'), 'mention');
  assert.equal(isAddressedTo(m('well @kira yes'), 'kira'), 'mention');
  assert.equal(isAddressedTo(m('hey @kira, fans'), 'kira'), 'mention');
  assert.equal(isAddressedTo(m('(@kira)'), 'kira'), 'mention');
  assert.equal(isAddressedTo(m('ends with @kira'), 'kira'), 'mention');
  assert.equal(isAddressedTo(m('@KIRA?!'), 'kira'), 'mention');
  assert.equal(isAddressedTo(m('@kira', { username: 'kira' }), 'kira'), 'reply', 'reply wins over mention');
});

test('isAddressedTo: longer nick, email-like, double @, no nick, bad input → null', () => {
  const m = (text) => ({ ...base, username: 'mox', text });
  assert.equal(isAddressedTo(m('@kiran hi'), 'kira'), null, '@kiran is someone else');
  assert.equal(isAddressedTo(m('@kira_x hi'), 'kira'), null);
  assert.equal(isAddressedTo(m('mail a@kira now'), 'kira'), null, 'email-like');
  assert.equal(isAddressedTo(m('@@kira'), 'kira'), null);
  assert.equal(isAddressedTo(m('kira without at'), 'kira'), null);
  assert.equal(isAddressedTo(m('@kira'), null), null);
  assert.equal(isAddressedTo(m('@kira'), ''), null);
  assert.equal(isAddressedTo(m(null), 'kira'), null);
  assert.equal(isAddressedTo(null, 'kira'), null);
  assert.equal(isAddressedTo({ ...base, text: '@a.b hi' }, 'a.b'), 'mention', 'regex metacharacters in the nick are escaped');
  assert.equal(isAddressedTo({ ...base, text: '@axb hi' }, 'a.b'), null);
});
