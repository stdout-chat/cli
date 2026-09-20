# Changelog

All notable changes to `stdout-chat` (the CLI). Dates are release dates.

## [0.4.1] — 2026-09-20

### What's New

- Your own line shows up once. Hitting Enter used to leave `> hi` on screen and then the feed printed `in  dmitrii  hi` right under it — two copies of everything you said, while the app showed one. Now the typed line is wiped the moment you submit and the feed's copy (with its id, ready for `/r`) is the only one. If the post fails (`slow down · retry in 2s`, revoked key), the line comes back dim above the error so you can see what did not go out — ↑ still recalls it.

### Technical

- `lib/ui.js`: `eraseSubmitted(line)` — cursor up + clear for every row the echoed `> line` took (`ceil((prompt + line) / columns)`), then column 0. Must run synchronously from `onLine`, before any await: readline has just written the newline, so the row above the cursor is exactly the echo; the next `print`/`prompt(true)` re-draws the prompt as usual.
- `lib/session.js`: `echoesViaStream(line)` — true for plain text and `/r|/reply <id> text`, false for commands, `/r` usage and unknown slashes (the server's 422 keeps its `> /dance` context). `post(text, reply, { unsent })`: on failure prints `> <unsent>` via `info` (dim) before the error; `handleInput` passes the raw line for posts and replies only.
- `bin/stdout-chat.js`: `onLine` calls `ui.eraseSubmitted(line)` when `echoesViaStream(line)`, then `handleInput`.
- Tests: 96 → 99 (erase sequences for one row and a wrapped line; `echoesViaStream` table; failed post restores the line, a failed command does not).

## [0.4.0] — 2026-09-20

### What's New

- Type `/` at the prompt and one dim line lists the commands (`commands · /help · /r <id> text · /dm <nick|sid> · /top · /who · /key · /notify · /clear · /quit`) — once per line, the input stays put. `/help` is unchanged.
- Tab completion: `/n⇥` → `/notify `, `/notify a⇥` → `all` (`mentions|all|off`), `/key ⇥` → `off`, and `@ki⇥` → `@kira ` from the nicks seen this session (most recent first, case-insensitive), anywhere in the line — inside a `/r` reply too. Plain text: Tab does nothing.

### Technical

- New `lib/complete.js`: pure `complete(line, { commands, nicks })` → `[matches, prefix]`, readline's completer shape. Commands come from a fixed list; `/notify` and `/key` complete their first argument; a token under the cursor starting with `@` completes against `nicks` (unique, caller's order). Everything else → `[[], '']`.
- `lib/ui.js`: `createUI({ completer, hint })`. The completer is handed to `readline.createInterface`. The hint is driven by a `keypress` listener added after `createInterface`, so it runs after readline applied the key and just reads `rl.line`: `'/'` and not yet hinted → print; `''` → reset; `'line'` → reset. No key parsing of our own, so editing and history are untouched; works in Terminal.app and tmux. Off in `--read` / `--tail` / piped modes (no prompt there).
- `lib/session.js`: `SLASH_HINT`; `nicks()` (most recent first, unique, no `anon`) feeds `@` completion. `bin/stdout-chat.js` wires both; the hint goes through `renderInfo`, so `NO_COLOR` / `--no-color` make it plain.
- Tests: 82 → 96 (`test/complete.test.js` and `test/ui.test.js` new — the UI is driven through fake streams so readline parses real key bytes; `nicks()` in session).

## [0.3.0] — 2026-09-20

### What's New

- `/dm <nick|sid>` at the prompt invites someone from #void to a private chat. Pass a nick, or the id of one of their lines (the dim column on the left) to target that author. The invite lives 10 minutes; accepting happens in the app, and the private chat itself opens on your phone — the CLI prints the server's answer (`invite sent · nova has 10 min · you'll get a push when they accept`) or its refusal verbatim (`not_found`, `busy`, `rate_limited` …).

### Technical

- `lib/api.js`: `dm({ nick | sid }, key)` → `POST /void/dm`, JSON body `{sid}` or `{nick}`, `Accept: application/json`, returns `{ id, to, expires_at }`. Errors go through the existing `ApiError` mapping (server `message` verbatim, `retry_after` honoured).
- `lib/session.js`: `cmdDm` — no key → the usual hint, no argument → `usage: /dm <nick|sid>`, argument equal to a `sid` seen this session → `{sid}`, otherwise `{nick}`; the success line is built from the returned `to`.
- Tests: 76 → 82 (`/dm` sid/nick routing, usage, no-key, verbatim errors; `api.dm` request shape).

## [0.2.0] — 2026-09-20

### What's New

- Desktop notifications on macOS and Linux: a banner when someone replies to your line or writes `@you` while the client is running (at the prompt or in `--tail`). Live lines only; history and your own lines never notify.
- `/notify` shows the level; `/notify mentions|all|off` sets it and saves it next to the key.
- `--no-notify` (and `--notify`) plus `STDOUT_CHAT_NO_NOTIFY=1` to silence a single run. Flag beats env beats config.

### Technical

- New `lib/notify.js`: `createNotifier()` wraps `osascript -e 'display notification …'` (darwin) / `notify-send -a stdout-chat` (linux); Windows and other platforms are a no-op. AppleScript escaping (`\` then `"`), body cut at 120 code points, control characters stripped, 3 s exec timeout, one banner per 2 s (drops, no queue). The first exec error disables banners for the session and prints one dim `· notifications unavailable here`.
- `lib/render.js`: `isAddressedTo(msg, myNick)` → `'reply' | 'mention' | null` (word-bounded, case-insensitive, `a@nick` does not count).
- `lib/session.js`: banner hook fires only on live `msg` events that were actually printed; `verifyKey({ quiet })` for `--tail`, which now checks a stored key silently to learn the nick.
- `lib/config.js`: `notify` persisted in `config.json`; `/key` preserves it. Files stay `0600`.
- Tests: 55 → 76 (`test/notify.test.js` new; `isAddressedTo`, session, config and smoke cases added).

## [0.1.0] — 2026-09-20

- First release: read, tail and post to `#void` from the terminal · zero dependencies · Node ≥ 18.
