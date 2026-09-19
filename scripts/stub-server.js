#!/usr/bin/env node
// Tiny local stand-in for the #void HTTP contract (not shipped; used by tests
// and for manual smoke runs). Usage: node scripts/stub-server.js [port]
// Env: STUB_KEY (default sc_test), STUB_SCRIPT (comma list of events to emit
// after a stream connects: msg,react,hide,topic,bye; default "msg"),
// STUB_DELAY_MS (gap between scripted events, default 150).
import http from 'node:http';

const KEY = process.env.STUB_KEY || 'sc_test';
const SCRIPT = (process.env.STUB_SCRIPT ?? 'msg').split(',').map((s) => s.trim()).filter(Boolean);
const DELAY = Number(process.env.STUB_DELAY_MS || 150);

let topic = "what's the most underrated sound?";
let nextId = 2;
const messages = [
  { id: 1, sid: 'a1b2', username: 'kira', tag: 'c31d', text: 'the hum of a fridge at 3am', ts: 1758240000, reactions: [['❤️', 2]], top: 1 },
];
const watchers = new Set();

const sid = (id) => id.toString(36).padStart(4, 'a');

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function broadcast(event, data, id) {
  const frame = `event: ${event}\n${id != null ? `id: ${id}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
  for (const w of watchers) w.write(frame);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => resolve(raw));
  });
}

async function runScript(res) {
  for (const step of SCRIPT) {
    await new Promise((r) => setTimeout(r, DELAY));
    if (!watchers.has(res)) return;
    switch (step) {
      case 'msg': {
        const m = { id: nextId++, sid: sid(nextId - 1), username: 'mox', tag: '9f2e', text: 'hello from the stub', ts: Date.now() / 1000 | 0,
          reply: { username: 'kira', text: 'the hum of a fridge at 3am', gone: false } };
        messages.push(m);
        broadcast('msg', m, m.id);
        break;
      }
      case 'react': broadcast('react', { id: 1, reactions: [['❤️', 3], ['😂', 1]] }); break;
      case 'hide': broadcast('hide', { id: 1 }); break;
      case 'topic': topic = 'silence'; broadcast('topic', { topic }); break;
      case 'bye': res.write('event: bye\ndata: {}\n\n'); res.end(); watchers.delete(res); return;
      default: break;
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (req.method === 'GET' && url.pathname === '/void') {
    const n = Math.min(100, Number(url.searchParams.get('n')) || 50);
    return send(res, 200, { topic, count: 3, top_week: [{ nick: 'kira', rank: 1 }, { nick: 'mox', rank: 2 }], messages: messages.slice(-n) });
  }

  if (req.method === 'GET' && url.pathname === '/void/stream') {
    if (process.env.STUB_STREAM_503) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      return res.end('too many watchers · try curl https://stdout.chat/void');
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    res.write(': ok\n\n');
    const last = Number(req.headers['last-event-id']);
    if (Number.isFinite(last)) for (const m of messages) if (m.id > last) res.write(`event: msg\nid: ${m.id}\ndata: ${JSON.stringify(m)}\n\n`);
    watchers.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); watchers.delete(res); });
    runScript(res);
    return undefined;
  }

  if (req.method === 'GET' && url.pathname === '/void/me') {
    if (bearer !== KEY) return send(res, 401, { error: 'no_key', message: bearer ? 'key revoked · /key new in the app' : 'no key · get one in the app: /key' });
    return send(res, 200, { username: 'kira', tag: 'c31d', top: 1, week: { rank: 1, authors: 7 } });
  }

  if (req.method === 'POST' && url.pathname === '/void') {
    if (bearer !== KEY) return send(res, 401, { error: 'no_key', message: 'no key · get one in the app: /key' });
    const raw = await readBody(req);
    let body = {};
    try { body = JSON.parse(raw); } catch { body = { text: raw }; }
    const text = String(body.text || '').trim();
    if (!text) return send(res, 422, { error: 'empty', message: 'say something' });
    if (text.length > 200) return send(res, 413, { error: 'too_long', message: `too long · 200 chars max (you sent ${text.length})` });
    if (text.startsWith('/')) return send(res, 422, { error: 'unknown_command', message: 'command not found' });
    const m = { id: nextId++, sid: sid(nextId - 1), username: 'kira', tag: 'c31d', text, ts: Date.now() / 1000 | 0 };
    if (body.reply) {
      const parent = messages.find((x) => x.sid === String(body.reply));
      if (!parent) return send(res, 404, { error: 'reply_gone', message: 'reply target gone' });
      m.reply = { username: parent.username, text: parent.text, gone: false };
    }
    messages.push(m);
    broadcast('msg', m, m.id);
    return send(res, 201, { id: m.id, sid: m.sid, username: m.username, text: m.text, ts: m.ts });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(Number(process.argv[2]) || 0, '127.0.0.1', () => {
  process.stdout.write(`PORT=${server.address().port}\n`);
});
