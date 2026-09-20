import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configDir, configPath, keyPath, loadConfig, saveConfig, removeConfig } from '../lib/config.js';

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stdout-chat-test-'));
  process.env.STDOUT_CHAT_CONFIG_DIR = path.join(tmp, 'cfg');
});
afterEach(() => {
  delete process.env.STDOUT_CHAT_CONFIG_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const mode = (p) => fs.statSync(p).mode & 0o777;

test('missing config loads as {}', () => {
  assert.deepEqual(loadConfig(), {});
});

test('save creates dir 0700 and files 0600; round-trips; writes plain key twin', () => {
  saveConfig({ key: 'sc_abc', api: 'http://127.0.0.1:1' });
  assert.deepEqual(loadConfig(), { key: 'sc_abc', api: 'http://127.0.0.1:1' });
  assert.equal(fs.readFileSync(keyPath(), 'utf8'), 'sc_abc\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath(), 'utf8')), { key: 'sc_abc', api: 'http://127.0.0.1:1' });
  if (process.platform !== 'win32') {
    assert.equal(mode(configDir()), 0o700);
    assert.equal(mode(configPath()), 0o600);
    assert.equal(mode(keyPath()), 0o600);
  }
});

test('save without api omits it; re-save tightens perms of an existing file', () => {
  saveConfig({ key: 'sc_one' });
  assert.deepEqual(loadConfig(), { key: 'sc_one' });
  if (process.platform !== 'win32') {
    fs.chmodSync(configPath(), 0o644);
    saveConfig({ key: 'sc_two' });
    assert.equal(mode(configPath()), 0o600);
  }
  assert.deepEqual(loadConfig(), { key: 'sc_two' });
});

test('garbage config is ignored; remove deletes both files', () => {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configPath(), '{not json');
  assert.deepEqual(loadConfig(), {});
  fs.writeFileSync(configPath(), '[1,2]');
  assert.deepEqual(loadConfig(), {});
  fs.writeFileSync(configPath(), JSON.stringify({ key: 42, api: 'x' }));
  assert.deepEqual(loadConfig(), { api: 'x' });
  saveConfig({ key: 'sc_x' });
  removeConfig();
  assert.equal(fs.existsSync(configPath()), false);
  assert.equal(fs.existsSync(keyPath()), false);
  removeConfig(); // idempotent
});

test('default path lives under ~/.config/stdout-chat (or XDG_CONFIG_HOME)', () => {
  delete process.env.STDOUT_CHAT_CONFIG_DIR;
  const saved = process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_CONFIG_HOME;
  assert.equal(configPath(), path.join(os.homedir(), '.config', 'stdout-chat', 'config.json'));
  process.env.XDG_CONFIG_HOME = '/x/y';
  assert.equal(configDir(), path.join('/x/y', 'stdout-chat'));
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = saved;
});

test('notify level round-trips; unknown values are dropped on read and on write', () => {
  saveConfig({ key: 'sc_n', notify: 'off' });
  assert.deepEqual(loadConfig(), { key: 'sc_n', notify: 'off' });
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath(), 'utf8')), { key: 'sc_n', notify: 'off' });
  saveConfig({ key: 'sc_n', notify: 'loud' });
  assert.deepEqual(loadConfig(), { key: 'sc_n' });
  fs.writeFileSync(configPath(), JSON.stringify({ key: 'sc_n', notify: 42 }));
  assert.deepEqual(loadConfig(), { key: 'sc_n' });
  saveConfig({ notify: 'all' });
  assert.deepEqual(loadConfig(), { notify: 'all' }, 'a level without a key is fine');
  assert.equal(fs.existsSync(keyPath()), false);
  if (process.platform !== 'win32') assert.equal(mode(configPath()), 0o600);
});
