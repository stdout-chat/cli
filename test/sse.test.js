import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SSEParser, readEvents } from '../lib/sse.js';

const feedAll = (chunks) => {
  const p = new SSEParser();
  return chunks.flatMap((c) => p.feed(c));
};

test('single complete event', () => {
  const evs = feedAll(['event: msg\nid: 12\ndata: {"a":1}\n\n']);
  assert.deepEqual(evs, [{ event: 'msg', id: '12', data: '{"a":1}' }]);
});

test('event split across arbitrary chunk boundaries (every split point)', () => {
  const frame = 'event: msg\nid: 7\ndata: {"text":"hi there"}\n\nevent: react\ndata: {"id":7}\n\n';
  const expected = [
    { event: 'msg', id: '7', data: '{"text":"hi there"}' },
    { event: 'react', id: '7', data: '{"id":7}' },
  ];
  for (let i = 1; i < frame.length; i++) {
    assert.deepEqual(feedAll([frame.slice(0, i), frame.slice(i)]), expected, `split at ${i}`);
  }
});

test('one character at a time', () => {
  const frame = 'data: a\ndata: b\n\n';
  assert.deepEqual(feedAll([...frame]), [{ event: 'message', id: '', data: 'a\nb' }]);
});

test('CRLF and lone CR line endings, including CR at a chunk edge', () => {
  assert.deepEqual(feedAll(['event: msg\r\ndata: x\r\n\r\n']), [{ event: 'msg', id: '', data: 'x' }]);
  // a trailing lone CR is held back until the next byte proves it is not CRLF
  const p = new SSEParser();
  assert.deepEqual(p.feed('event: msg\rdata: x\r\r'), []);
  assert.deepEqual(p.feed(': next\n'), [{ event: 'msg', id: '', data: 'x' }]);
  assert.deepEqual(feedAll(['event: msg\r', '\ndata: x\r', '\n\r\n']), [{ event: 'msg', id: '', data: 'x' }]);
});

test('comments (heartbeats) are ignored and never dispatch', () => {
  const evs = feedAll([': ok\n\n: ping\n\n', 'event: topic\ndata: {"topic":"t"}\n\n', ': ping\n\n']);
  assert.deepEqual(evs, [{ event: 'topic', id: '', data: '{"topic":"t"}' }]);
});

test('multi-line data joins with newline; leading single space stripped; no-colon field', () => {
  const evs = feedAll(['data: line one\ndata:  two spaces\ndata\n\n']);
  assert.deepEqual(evs, [{ event: 'message', id: '', data: 'line one\n two spaces\n' }]);
});

test('last event id persists across events; NUL ids are ignored; retry parsed', () => {
  const p = new SSEParser();
  const a = p.feed('id: 3\ndata: a\n\nretry: 2500\ndata: b\n\nid: bad\0\ndata: c\n\n');
  assert.deepEqual(a.map((e) => e.id), ['3', '3', '3']);
  assert.equal(p.retry, 2500);
  assert.equal(p.lastEventId, '3');
});

test('blank line without data does not dispatch but resets event name', () => {
  const evs = feedAll(['event: bye\n\n', 'data: x\n\n']);
  assert.deepEqual(evs, [{ event: 'message', id: '', data: 'x' }]);
});

test('bye with a data payload is delivered', () => {
  assert.deepEqual(feedAll(['event: bye\ndata: {}\n\n']), [{ event: 'bye', id: '', data: '{}' }]);
});

test('readEvents iterates a byte stream and decodes multi-byte UTF-8 split across chunks', async () => {
  const bytes = new TextEncoder().encode('event: msg\ndata: {"t":"❤️ да"}\n\n');
  const chunks = [bytes.slice(0, 20), bytes.slice(20, 21), bytes.slice(21)];
  const body = new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); },
  });
  const seen = [];
  let ticks = 0;
  for await (const ev of readEvents(body, { onChunk: () => ticks++ })) seen.push(ev);
  assert.deepEqual(seen, [{ event: 'msg', id: '', data: '{"t":"❤️ да"}' }]);
  assert.equal(ticks, 3);
});
