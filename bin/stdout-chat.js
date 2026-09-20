#!/usr/bin/env node
// stdout-chat — #void from your terminal. Zero dependencies, Node ≥ 18.
import fs from 'node:fs';
import process from 'node:process';
import { createApi, DEFAULT_API, errorMessage } from '../lib/api.js';
import { loadConfig } from '../lib/config.js';
import { createUI } from '../lib/ui.js';
import { Session } from '../lib/session.js';
import { renderError, renderInfo } from '../lib/render.js';
import { createNotifier } from '../lib/notify.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const USAGE = `stdout-chat ${pkg.version} — #void from your terminal

usage: npx stdout-chat [options]

  --read          print the last N lines and exit
  --tail          stream only: no history, no prompt
  -n <count>      how many lines to load (default 30, max 100)
  --api <url>     API base (default ${DEFAULT_API}; env STDOUT_CHAT_API)
  --no-color      plain output (NO_COLOR is honoured too)
  --no-notify     no desktop banners (env STDOUT_CHAT_NO_NOTIFY=1 works too)
  -h, --help      this text
  -v, --version   print the version

at the prompt:
  /help  /r <id> text  /top  /who  /key sc_…  /key off  /notify  /clear  /quit
  anything else is posted to #void

desktop banners (macOS / Linux) when someone replies to you or writes @you —
only while the prompt or --tail is running · /notify mentions|all|off

key file: ~/.config/stdout-chat/config.json (get a key in the app: /key)
no telemetry · https://stdout.chat/void`;

class UsageError extends Error {}

function parseArgs(argv) {
  const o = { read: false, tail: false, api: null, color: true, notify: null, help: false, version: false, n: 30 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const k = eq > 0 ? a.slice(0, eq) : a;
    const inline = eq > 0 ? a.slice(eq + 1) : undefined;
    const next = () => (inline !== undefined ? inline : argv[++i]);
    switch (k) {
      case '--read': o.read = true; break;
      case '--tail': o.tail = true; break;
      case '--api': o.api = next(); if (!o.api) throw new UsageError('--api needs a url'); break;
      case '--no-color': o.color = false; break;
      case '--color': o.color = true; break;
      case '--no-notify': o.notify = false; break;
      case '--notify': o.notify = true; break;
      case '-h': case '--help': o.help = true; break;
      case '-v': case '--version': o.version = true; break;
      case '-n': case '--lines': {
        const v = next();
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) throw new UsageError(`-n needs a positive number, got "${v ?? ''}"`);
        o.n = Math.min(n, 100);
        break;
      }
      default:
        throw new UsageError(`unknown option: ${a}`);
    }
  }
  return o;
}

function wantColor(opts) {
  if (!opts.color) return false;
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR != null && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(process.stdout.isTTY);
}

// flag > env > config > default. Returns the level ('mentions' | 'all' | 'off').
function wantNotify(opts, cfg) {
  if (opts.notify === false) return 'off';
  if (opts.notify === true) return cfg.notify && cfg.notify !== 'off' ? cfg.notify : 'mentions';
  const env = process.env.STDOUT_CHAT_NO_NOTIFY;
  if (env != null && env !== '' && env !== '0') return 'off';
  return cfg.notify || 'mentions';
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}\n`);
    return 2;
  }
  if (opts.help) { process.stdout.write(`${USAGE}\n`); return 0; }
  if (opts.version) { process.stdout.write(`${pkg.version}\n`); return 0; }

  const cfg = loadConfig();
  const explicitApi = opts.api || process.env.STDOUT_CHAT_API || null;
  const base = explicitApi || cfg.api || DEFAULT_API;
  const api = createApi({ base, version: pkg.version });
  const color = wantColor(opts);

  const mode = opts.read ? 'read'
    : opts.tail ? 'tail'
      : (process.stdin.isTTY && process.stdout.isTTY) ? 'interactive'
        : 'follow'; // piped: history + stream, no prompt

  const ui = createUI();
  const stop = new AbortController();
  let closing = false;

  const session = new Session({
    api,
    print: ui.print,
    color,
    width: () => process.stdout.columns || 80,
    key: cfg.key || null,
    persistApi: api.base !== DEFAULT_API ? api.base : null, // keep a non-default api next to the key
    n: opts.n,
    onQuit: () => shutdown(0),
    notifyLevel: wantNotify(opts, cfg),
  });
  session.onClear = () => ui.clear();
  // Banners only where a human is watching a live feed: never in --read, never
  // when stdout is a pipe (follow mode). The level gates the hook at runtime, so
  // `/notify all` after `--no-notify` works without a restart; nothing spawns
  // until a line actually qualifies.
  if (mode === 'interactive' || mode === 'tail') {
    session.notify = createNotifier({
      onUnavailable: () => ui.print(renderInfo('· notifications unavailable here', { color })),
    }).notify;
  }

  function shutdown(code = 0) {
    if (closing) return;
    closing = true;
    stop.abort();
    ui.close();
    process.exitCode = code;
    const t = setTimeout(() => process.exit(code), 500);
    t.unref();
  }

  if (mode === 'read') {
    try {
      await session.loadHistory({ show: true, n: opts.n });
      return 0;
    } catch (err) {
      process.stdout.write(`${renderError(errorMessage(err), { color })}\n`);
      return 1;
    }
  }

  process.on('SIGTERM', () => shutdown(0));
  process.on('SIGHUP', () => shutdown(0));
  if (mode !== 'interactive') process.on('SIGINT', () => shutdown(0));

  if (mode === 'tail' && session.key && session.notify) {
    await session.verifyKey({ quiet: true }); // only to learn the nick for reply / @mention matching
  }
  if (mode !== 'tail') {
    await session.verifyKey();
    try {
      await session.loadHistory({ show: true, n: opts.n });
    } catch (err) {
      session.error(errorMessage(err));
      if (mode === 'follow') return 1;
    }
    if (mode === 'interactive') session.greet();
  }

  if (mode === 'interactive') {
    ui.start({
      onLine: async (line) => {
        try {
          await session.handleInput(line);
        } catch (err) {
          session.error(errorMessage(err));
        }
        if (/^\s*\/key\s+sc_/i.test(line)) ui.scrubHistory((h) => /^\s*\/key\s+sc_/i.test(h));
      },
      onClose: () => shutdown(0),
    });
  }

  await session.runStream(stop.signal);
  return process.exitCode || 0;
}

main().then(
  (code) => { if (!process.exitCode) process.exitCode = code; },
  (err) => {
    process.stderr.write(`${renderError(errorMessage(err), { color: false })}\n`);
    process.exitCode = 1;
  },
);
