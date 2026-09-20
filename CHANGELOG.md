# Changelog

All notable changes to `stdout-chat` (the CLI). Dates are release dates.

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
