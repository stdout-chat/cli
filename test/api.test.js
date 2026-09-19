import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError, errorMessage, DEFAULT_API } from '../lib/api.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const jsonRes = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function stub(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), init }); return handler(String(url), init); };
  return calls;
}

test('base url normalisation and default', () => {
  assert.equal(createApi().base, DEFAULT_API);
  assert.equal(createApi({ base: 'http://127.0.0.1:4001/' }).base, 'http://127.0.0.1:4001');
  assert.equal(createApi({ base: 'stage.example.com' }).base, 'https://stage.example.com');
});

test('getVoid sends Accept + User-Agent, clamps n, returns json', async () => {
  const calls = stub(() => jsonRes(200, { topic: 't', count: 1, messages: [] }));
  const api = createApi({ base: 'http://h', version: '0.1.0' });
  const data = await api.getVoid(500);
  assert.deepEqual(data, { topic: 't', count: 1, messages: [] });
  assert.equal(calls[0].url, 'http://h/void?n=100');
  assert.equal(calls[0].init.headers.Accept, 'application/json');
  assert.equal(calls[0].init.headers['User-Agent'], `stdout-chat-cli/0.1.0 node/${process.version}`);
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test('post sends Bearer + JSON body with optional reply and returns 201 payload', async () => {
  const calls = stub(() => jsonRes(201, { id: 9, sid: 'a1b9', username: 'kira', text: 'hi', ts: 1 }));
  const api = createApi({ base: 'http://h' });
  const out = await api.post({ text: 'hi', reply: 'a1b2' }, 'sc_k');
  assert.equal(out.sid, 'a1b9');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sc_k');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: 'hi', reply: 'a1b2' });
  await api.post({ text: 'x' }, 'sc_k');
  assert.deepEqual(JSON.parse(calls[1].init.body), { text: 'x' });
});

test('JSON error → ApiError with the server message verbatim, code, retry_after, until', async () => {
  stub(() => jsonRes(429, { error: 'rate_limited', message: 'slow down · retry in 2s', retry_after: 2, until: 123 }, { 'retry-after': '5' }));
  const api = createApi({ base: 'http://h' });
  await assert.rejects(api.post({ text: 'x' }, 'sc_k'), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.message, 'slow down · retry in 2s');
    assert.equal(err.status, 429);
    assert.equal(err.code, 'rate_limited');
    assert.equal(err.retryAfter, 2);
    assert.equal(err.until, 123);
    assert.equal(errorMessage(err), 'slow down · retry in 2s');
    return true;
  });
});

test('401 from /void/me maps to its message', async () => {
  stub(() => jsonRes(401, { error: 'no_key', message: 'key revoked · /key new in the app' }));
  await assert.rejects(createApi({ base: 'http://h' }).getMe('sc_old'), { message: 'key revoked · /key new in the app', status: 401 });
});

test('text error body (503 too many watchers) is used verbatim; empty body → http <status>', async () => {
  stub(() => new Response('too many watchers · try curl https://stdout.chat/void', { status: 503, headers: { 'content-type': 'text/plain' } }));
  await assert.rejects(createApi({ base: 'http://h' }).openStream(), { message: 'too many watchers · try curl https://stdout.chat/void', status: 503 });
  stub(() => new Response('', { status: 502 }));
  await assert.rejects(createApi({ base: 'http://h' }).getVoid(), { message: 'http 502', status: 502 });
});

test('network failure → "network error · <cause>", never a stack trace', async () => {
  stub(() => { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; });
  await assert.rejects(createApi({ base: 'http://h' }).getVoid(), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.message, 'network error · ECONNREFUSED');
    assert.equal(err.status, 0);
    return true;
  });
});

test('abort is passed through untouched', async () => {
  stub(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
  await assert.rejects(createApi({ base: 'http://h' }).openStream({ signal: new AbortController().signal }), { name: 'AbortError' });
});

test('openStream sends Last-Event-ID only when known and returns the Response', async () => {
  const calls = stub(() => new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  const api = createApi({ base: 'http://h' });
  const res = await api.openStream({ lastEventId: '42' });
  assert.equal(res.status, 200);
  assert.equal(calls[0].url, 'http://h/void/stream');
  assert.equal(calls[0].init.headers['Last-Event-ID'], '42');
  assert.equal(calls[0].init.headers.Accept, 'application/json');
  await api.openStream({});
  assert.equal(calls[1].init.headers['Last-Event-ID'], undefined);
});

test('non-JSON 200 body is an ApiError, not a SyntaxError', async () => {
  stub(() => new Response('<html>', { status: 200 }));
  await assert.rejects(createApi({ base: 'http://h' }).getVoid(), { message: 'bad response · not json' });
});
