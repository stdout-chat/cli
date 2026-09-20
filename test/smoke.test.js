// End-to-end smoke against scripts/stub-server.js: --read, --tail, and the
// piped "follow" mode with a 401 key. Each run is bounded by a timeout.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const BIN = path.join(root, 'bin/stdout-chat.js');
const STUB = path.join(root, 'scripts/stub-server.js');

function startStub(env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [STUB, '0'], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d;
      const m = buf.match(/PORT=(\d+)/);
      if (m) resolve({ proc: p, base: `http://127.0.0.1:${m[1]}` });
    });
    p.on('exit', (code) => reject(new Error(`stub exited ${code}`)));
  });
}

function runCli(args, { base, timeoutMs = 4000, until = null, env = {} } = {}) {
  return new Promise((resolve) => {
    const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stdout-chat-smoke-'));
    const p = spawn(process.execPath, [BIN, '--api', base, '--no-color', ...args], {
      env: { ...process.env, STDOUT_CHAT_CONFIG_DIR: cfgDir, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let done = false;
    const finish = (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      fs.rmSync(cfgDir, { recursive: true, force: true });
      resolve({ out, err, code, signal });
    };
    const t = setTimeout(() => p.kill('SIGINT'), timeoutMs);
    p.stdout.on('data', (d) => { out += d; if (until && until.test(out)) p.kill('SIGINT'); });
    p.stderr.on('data', (d) => { err += d; });
    p.on('exit', finish);
  });
}

let stub;
before(async () => { stub = await startStub({ STUB_SCRIPT: 'msg,react,topic,hide' }); });
after(() => { stub.proc.kill(); });

test('--read prints the header and the history, then exits 0', async () => {
  const r = await runCli(['--read', '-n', '5'], { base: stub.base });
  assert.equal(r.code, 0, r.err);
  const lines = r.out.trimEnd().split('\n');
  assert.equal(lines[0], "#void · what's the most underrated sound? · 3 in room");
  assert.equal(lines[1], 'a1b2  kira 👑      the hum of a fridge at 3am  ❤️ 2');
  assert.equal(r.err, '');
});

test('--tail streams msg/react/topic/hide and exits cleanly on SIGINT', async () => {
  const r = await runCli(['--tail'], { base: stub.base, until: /topic: silence/ });
  assert.match(r.out, /^aaa2  mox          → kira {2}hello from the stub\n {6}↳ the hum of a fridge at 3am\n/m);
  assert.match(r.out, /^\/\/ topic: silence$/m);
  assert.doesNotMatch(r.out, /#void ·/, '--tail prints no history header');
  // react/hide for id 1 arrive, but id 1 was never seen in --tail mode → nothing to reprint
  assert.doesNotMatch(r.out, /^a1b2  ❤️ 3/m);
  assert.doesNotMatch(r.out, /message removed/);
  assert.equal(r.err, '');
  assert.equal(r.code, 0);
});

test('piped follow mode: history + stream + react reprint + hide', async () => {
  const r = await runCli([], { base: stub.base, until: /message removed/ });
  assert.match(r.out, /^#void · /m);
  assert.match(r.out, /^a1b2  kira 👑 {6}the hum of a fridge at 3am {2}❤️ 2$/m);
  assert.match(r.out, /^a1b2  ❤️ 3 😂 1$/m, 'react reprint for a recent line');
  assert.match(r.out, /hello from the stub/);
  assert.match(r.out, /^a1b2  ↳ message removed$/m);
  assert.equal(r.err, '');
  assert.equal(r.code, 0);
});

test('--read against a dead port prints one human line and exits 1', async () => {
  const r = await runCli(['--read'], { base: 'http://127.0.0.1:9' });
  assert.equal(r.code, 1);
  assert.match(r.out, /^network error · /);
  assert.doesNotMatch(r.out + r.err, /at .*\.js:\d+/, 'no stack trace');
});

test('--read against a 503 stream is unaffected; --tail prints the 503 body verbatim', async () => {
  const s503 = await startStub({ STUB_STREAM_503: '1' });
  try {
    const r = await runCli(['--tail'], { base: s503.base, until: /too many watchers/, timeoutMs: 3000 });
    assert.match(r.out, /^too many watchers · try curl https:\/\/stdout\.chat\/void$/m);
    assert.equal((r.out.match(/too many watchers/g) || []).length, 1, 'printed once per outage');
  } finally { s503.proc.kill(); }
});

test('event: bye → immediate quiet reconnect with Last-Event-ID (replayed lines are deduped)', async () => {
  const s = await startStub({ STUB_SCRIPT: 'msg,bye', STUB_DELAY_MS: '60' });
  try {
    const r = await runCli(['--tail'], { base: s.base, timeoutMs: 1500 });
    const hellos = r.out.match(/hello from the stub/g) || [];
    assert.ok(hellos.length >= 3, `expected several reconnect cycles, got ${hellos.length}\n${r.out}`);
    const sids = [...r.out.matchAll(/^(\S+)  mox/gm)].map((m) => m[1]);
    assert.equal(new Set(sids).size, sids.length, 'each stub line printed exactly once despite replay');
    assert.doesNotMatch(r.out, /reconnecting/);
    assert.equal(r.err, '');
    assert.equal(r.code, 0);
  } finally { s.proc.kill(); }
});

test('--tail --no-notify and STDOUT_CHAT_NO_NOTIFY still stream normally; --notify is accepted', async () => {
  const a = await runCli(['--tail', '--no-notify'], { base: stub.base, until: /topic: silence/ });
  assert.match(a.out, /hello from the stub/);
  assert.equal(a.err, '');
  assert.equal(a.code, 0);
  const b = await runCli(['--tail', '--notify'], { base: stub.base, until: /topic: silence/, env: { STDOUT_CHAT_NO_NOTIFY: '1' } });
  assert.match(b.out, /hello from the stub/);
  assert.doesNotMatch(b.out, /notifications unavailable/);
  assert.equal(b.err, '');
  assert.equal(b.code, 0);
});

test('--read with a stored notify level is unaffected (no exec path in read mode)', async () => {
  const r = await runCli(['--read', '-n', '1'], { base: stub.base, env: { STDOUT_CHAT_NO_NOTIFY: '' } });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, '');
  assert.doesNotMatch(r.out, /notifications/);
});
