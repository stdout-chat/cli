# stdout-chat

`#void` from your terminal. A tiny client for the public room of [stdout.chat](https://stdout.chat) — read it, tail it live, post to it from a shell.

```
npx stdout-chat
```

Zero dependencies · Node ≥ 18 · ESM · MIT · no telemetry.

```
#void · what's the most underrated sound? · 3 in room
a1b2  kira 👑      the hum of a fridge at 3am  ❤️ 2 😂 1
a1b4  mox          → kira  ceiling fans, obviously
      ↳ the hum of a fridge at 3am
a1b5  anon·c31d    ping
type /key sc_… to post · get it in the app: /key
>
```

## Reading

Anyone can read. The first run prints the last 30 lines and keeps tailing.

```
npx stdout-chat            # history + live tail + prompt
npx stdout-chat --read     # print the last N lines and exit
npx stdout-chat --tail     # live tail only, no prompt (pipe-friendly)
npx stdout-chat -n 100     # more history
```

## Posting: get a key

Posting is tied to your identity in the app. Open **#void** in the stdout.chat iOS app and type `/key` — it whispers you a key starting with `sc_`. Then, at the CLI prompt:

```
/key sc_…
```

The key is checked against the server, then saved to `~/.config/stdout-chat/config.json` (directory `0700`, file `0600`) with a plain-text twin `~/.config/stdout-chat/key` for shell scripts. Nothing else is stored. Rotate with `/key new` in the app; revoke with `/key off` in the app (`/key off` at the CLI only forgets the local copy).

## Commands

| at the `>` prompt | |
|---|---|
| `anything else` | posted to #void as-is (`@nick` mentions pass through) |
| `/r <id> text` | reply to a line — ids are the dim column on the left |
| `/top` | this week's top authors |
| `/who` | how many are in the room |
| `/key sc_…` | save a key · `/key` shows who you are · `/key off` forgets it |
| `/clear` | clear the screen |
| `/help` | list this |
| `/quit` | leave (Ctrl-C and Ctrl-D too) |

Server errors are printed as the server phrases them (`slow down · retry in 2s`), never as stack traces. Your own line is not echoed locally — it shows up when the room sees it, in order.

## Flags

```
--read          print the last N lines and exit
--tail          stream only: no history, no prompt
-n <count>      lines of history (default 30, max 100)
--api <url>     API base (default https://api.stdout.chat; env STDOUT_CHAT_API)
--no-color      plain output (NO_COLOR is honoured too)
--help, --version
```

## Without the CLI: curl

The same room over plain HTTP.

```
curl https://stdout.chat/void
curl -N https://api.stdout.chat/void/stream
curl -d 'hi' -H "Authorization: Bearer $(cat ~/.config/stdout-chat/key)" https://stdout.chat/void
```

A `void()` for your `.bashrc` / `.zshrc`:

```bash
void() {  # void · void -f · void -r a1b4 text · void some words
  local api=https://stdout.chat/void key=~/.config/stdout-chat/key reply=
  case "$1" in
    "") curl -s "$api"; return ;;
    -f) curl -sN https://api.stdout.chat/void/stream; return ;;
    -r) reply="$2"; shift 2 ;;
  esac
  [ -s "$key" ] || { echo "no key · in the app: /key, then: umask 077; echo sc_… > $key" >&2; return 1; }
  curl -s -H "Authorization: Bearer $(cat "$key")" --data-urlencode "text=$*" ${reply:+--data-urlencode "reply=$reply"} "$api"
}
```

## How it works

- `GET /void` for history, `GET /void/stream` (Server-Sent Events) for the live feed, `POST /void` to speak, `GET /void/me` to check a key. All JSON.
- Reconnects with backoff (1 → 30 s) and `Last-Event-ID`, so nothing is missed across the server's 15-minute stream rotation.
- Plain scrolling output with a `readline` prompt: no alternate screen, no curses — works in tmux splits and over ssh.

## Privacy

No telemetry, no analytics, no crash reporting. The only thing the server learns is what any HTTP client sends: your requests and a `User-Agent` of `stdout-chat-cli/<version> node/<version>`. The key lives only in your config directory.

## Development

```
git clone https://github.com/stdout-chat/cli && cd cli
node --test                      # unit + smoke tests (spins up scripts/stub-server.js)
node scripts/stub-server.js 4999 # fake server; STUB_KEY=sc_test
node bin/stdout-chat.js --api http://127.0.0.1:4999
```

## License

MIT © 2026 stdout.chat
