// createUI driven through fake streams: readline in terminal mode parses the
// bytes we write to `input` into keypresses exactly as it would from a tty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { createUI } from '../lib/ui.js';
import { complete } from '../lib/complete.js';

const HINT = 'commands · /help · /quit';
const tick = () => new Promise((r) => setTimeout(r, 15));

function makeUI({ hint = HINT, completer = (l) => complete(l, { nicks: ['kira', 'mox'] }) } = {}) {
  const input = new PassThrough();
  let out = '';
  const output = new Writable({ write(c, _e, cb) { out += c; cb(); } });
  output.columns = 80;
  const lines = [];
  const ui = createUI({ input, output, prompt: '> ', completer, hint });
  ui.start({ onLine: (l) => { lines.push(l); }, onClose: () => {} });
  return { ui, input, lines, out: () => out, hints: () => (out.match(/commands · \/help/g) || []).length, type: async (s) => { input.write(s); await tick(); } };
}

test('typing "/" prints the hint exactly once, above a re-rendered prompt that keeps the input', async () => {
  const u = makeUI();
  await u.type('/');
  assert.equal(u.hints(), 1);
  assert.match(u.out(), /commands · \/help · \/quit\n.*> \//s, 'hint line, then the prompt with "/" preserved');
  await u.type('h');
  assert.equal(u.hints(), 1, '"/h" does not repeat it');
  await u.type('\x7f'); // backspace → "/"
  assert.equal(u.hints(), 1, 'backspacing back to "/" does not repeat it');
  u.ui.close();
});

test('submitting resets the hint; so does clearing the line', async () => {
  const u = makeUI();
  await u.type('/help\r');
  assert.deepEqual(u.lines, ['/help']);
  assert.equal(u.hints(), 1);
  await u.type('/');
  assert.equal(u.hints(), 2, 'a new line gets its own hint');
  await u.type('\x15'); // Ctrl-U → empty
  await u.type('/');
  assert.equal(u.hints(), 3, 'cleared line counts as new');
  await u.type('\x7f/'); // backspace to empty, then "/" again
  assert.equal(u.hints(), 4);
  u.ui.close();
});

test('plain text never hints; a "/" typed later in the line never hints', async () => {
  const u = makeUI();
  await u.type('hello /help\r');
  assert.equal(u.hints(), 0);
  assert.deepEqual(u.lines, ['hello /help']);
  u.ui.close();
});

test('no hint injected (or none wanted) → nothing is printed', async () => {
  const u = makeUI({ hint: null });
  await u.type('/');
  assert.equal(u.hints(), 0);
  assert.doesNotMatch(u.out(), /commands/);
  u.ui.close();
});

test('Tab completes /n → "/notify ", "/notify a" → all, "@ki" → "@kira "; plain text Tab is inert', async () => {
  const u = makeUI();
  await u.type('/n\t');
  await u.type('a\t');
  await u.type('\r');
  assert.deepEqual(u.lines, ['/notify all']);
  await u.type('hey @ki\t');
  await u.type('\r');
  assert.deepEqual(u.lines.at(-1), 'hey @kira ');
  await u.type('plain\t');
  await u.type('\r');
  assert.deepEqual(u.lines.at(-1), 'plain');
  assert.equal(u.hints(), 1, 'only the /n line hinted');
  u.ui.close();
});

test('without a completer readline behaves as before (a literal tab is inserted)', async () => {
  const u = makeUI({ completer: null });
  await u.type('/n\t\r');
  assert.deepEqual(u.lines, ['/n\t']);
  u.ui.close();
});

test('eraseSubmitted wipes the echoed input row(s) above the cursor, then re-prompts on the next print', async () => {
  const u = makeUI();
  await u.type('hello\r');
  assert.deepEqual(u.lines, ['hello']);
  const before = u.out().length;
  u.ui.eraseSubmitted('hello');
  const tail = u.out().slice(before);
  assert.match(tail, /\x1b\[1A/, 'cursor moved up one row');
  assert.match(tail, /\x1b\[2K/, 'that row was cleared');
  assert.equal((tail.match(/\x1b\[1A/g) || []).length, 1, 'a short line is one row');
  u.ui.eraseSubmitted('x'.repeat(200)); // 80 columns → "> " + 200 chars = 3 rows
  assert.equal((u.out().slice(before).match(/\x1b\[1A/g) || []).length, 4, 'a wrapped line erases every row it took');
  u.ui.close();
});
