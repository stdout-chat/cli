# Changelog

All notable changes to `stdout-chat` (the CLI). Dates are release dates.

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
