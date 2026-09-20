// Key storage: ~/.config/stdout-chat/config.json  { "key": "sc_…", "api": "https://…", "notify": "mentions" }
// plus a plain-text twin ~/.config/stdout-chat/key so shell one-liners can
// `$(cat ~/.config/stdout-chat/key)`. Directory 0700, files 0600.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NOTIFY_LEVELS } from './notify.js';

export function configDir() {
  if (process.env.STDOUT_CHAT_CONFIG_DIR) return process.env.STDOUT_CHAT_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'stdout-chat');
}

export function configPath() {
  return path.join(configDir(), 'config.json');
}

export function keyPath() {
  return path.join(configDir(), 'key');
}

/** Returns {} when missing or unreadable; never throws. */
export function loadConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    if (typeof parsed.key === 'string' && parsed.key) out.key = parsed.key;
    if (typeof parsed.api === 'string' && parsed.api) out.api = parsed.api;
    if (NOTIFY_LEVELS.includes(parsed.notify)) out.notify = parsed.notify;
    return out;
  } catch {
    return {};
  }
}

function writePrivate(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch { /* win32 */ }
  fs.renameSync(tmp, file);
}

function rmQuiet(file) {
  try { fs.unlinkSync(file); } catch { /* absent */ }
}

/** Writes config.json (+ plain `key` file). `api` / `notify` are omitted when falsy or unknown. */
export function saveConfig({ key, api, notify } = {}) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* win32 */ }
  const data = {};
  if (key) data.key = key;
  if (api) data.api = api;
  if (NOTIFY_LEVELS.includes(notify)) data.notify = notify;
  writePrivate(configPath(), `${JSON.stringify(data, null, 2)}\n`);
  if (key) writePrivate(keyPath(), `${key}\n`);
  else rmQuiet(keyPath());
}

/** Deletes the local key files (server-side revoke happens in the app). */
export function removeConfig() {
  rmQuiet(configPath());
  rmQuiet(keyPath());
}
