import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complete, COMMANDS, NOTIFY_ARGS } from '../lib/complete.js';

const nicks = ['mox', 'Kira', 'nova', 'kira', 'mox', 'kip'];

test('exact "/" offers every command, in order, replacing the slash', () => {
  assert.deepEqual(complete('/', { nicks }), [COMMANDS, '/']);
  assert.deepEqual(COMMANDS, ['/help', '/r ', '/dm ', '/top', '/who', '/key ', '/notify ', '/clear', '/quit']);
});

test('command prefixes: /n → "/notify " (with the trailing space), /h, /q; case-insensitive; unknown → nothing', () => {
  assert.deepEqual(complete('/n'), [['/notify '], '/n']);
  assert.deepEqual(complete('/h'), [['/help'], '/h']);
  assert.deepEqual(complete('/q'), [['/quit'], '/q']);
  assert.deepEqual(complete('/N'), [['/notify '], '/N']);
  assert.deepEqual(complete('/notify'), [['/notify '], '/notify']);
  assert.deepEqual(complete('/dance'), [[], '/dance']);
});

test('/notify completes its argument to mentions|all|off; /key offers off only', () => {
  assert.deepEqual(complete('/notify a'), [['all'], 'a']);
  assert.deepEqual(complete('/notify '), [NOTIFY_ARGS, '']);
  assert.deepEqual(complete('/notify  ME'), [['mentions'], 'ME']);
  assert.deepEqual(complete('/NOTIFY o'), [['off'], 'o']);
  assert.deepEqual(complete('/notify all x'), [[], ''], 'a second argument gets nothing');
  assert.deepEqual(complete('/key o'), [['off'], 'o']);
  assert.deepEqual(complete('/key '), [['off'], '']);
  assert.deepEqual(complete('/key sc_abc'), [[], 'sc_abc'], 'never invents keys');
});

test('other commands\' arguments get nothing (/r id, /dm nick)', () => {
  assert.deepEqual(complete('/r a1'), [[], '']);
  assert.deepEqual(complete('/dm no'), [[], '']);
  assert.deepEqual(complete('/top '), [[], '']);
});

test('@ki → "@kira " with a trailing space; case-insensitive; nick order kept, duplicates dropped', () => {
  assert.deepEqual(complete('@ki', { nicks }), [['@Kira ', '@kira ', '@kip '], '@ki']);
  assert.deepEqual(complete('@KI', { nicks: ['kira'] }), [['@kira '], '@KI']);
  assert.deepEqual(complete('@mo', { nicks }), [['@mox '], '@mo'], 'mox appears once');
  assert.deepEqual(complete('@', { nicks }), [['@mox ', '@Kira ', '@nova ', '@kira ', '@kip '], '@'], 'bare @ lists everyone, most recent first as given');
  assert.deepEqual(complete('@zz', { nicks }), [[], '@zz']);
  assert.deepEqual(complete('@ki'), [[], '@ki'], 'no nicks known');
});

test('mid-line @ token: only the token under the cursor is completed', () => {
  assert.deepEqual(complete('hey @ki', { nicks }), [['@Kira ', '@kira ', '@kip '], '@ki']);
  assert.deepEqual(complete('hey @kira, and @no', { nicks }), [['@nova '], '@no']);
  assert.deepEqual(complete('/r a1b2 thanks @mo', { nicks }), [['@mox '], '@mo'], '@ works inside a /r reply too');
  assert.deepEqual(complete('a@ki', { nicks }), [[], ''], 'an email-ish token is not a mention');
  assert.deepEqual(complete('hey @kira ', { nicks }), [[], ''], 'after the space nothing is pending');
});

test('plain text and empty input get no completions, so Tab is inert', () => {
  assert.deepEqual(complete('ceiling fans', { nicks }), [[], '']);
  assert.deepEqual(complete('', { nicks }), [[], '']);
  assert.deepEqual(complete(null, { nicks }), [[], '']);
  assert.deepEqual(complete('help'), [[], '']);
});
