// Readline management: plain scrolling output with a `> ` prompt pinned at the
// bottom. No alternate screen, no curses — works in tmux splits and pipes.
import readline from 'node:readline';

/**
 * `completer(line) → [matches, prefix]` is handed to readline as-is (see
 * lib/complete.js). `hint` is one already-rendered line printed above the
 * prompt the first time an input line becomes exactly `/`.
 */
export function createUI({ input = process.stdin, output = process.stdout, prompt = '> ', completer = null, hint = null } = {}) {
  let rl = null;
  let closed = false;
  let hinted = false; // the `/` hint was shown for the line being typed

  function print(text) {
    if (closed && !rl) { output.write(`${text}\n`); return; }
    if (rl) {
      readline.clearLine(output, 0);
      readline.cursorTo(output, 0);
    }
    output.write(`${text}\n`);
    if (rl) rl.prompt(true);
  }

  // Why a keypress listener that reads `rl.line` (and not our own key parser):
  // readline installs its keypress handler in createInterface, so a listener
  // added afterwards runs after readline has already applied the key — `rl.line`
  // is the edited line, whatever the key was (typed char, paste, backspace,
  // Ctrl-U, history arrow). We never touch the key ourselves, so editing and
  // history behave exactly as before, in Terminal.app and in tmux alike. The
  // flag resets on submit ('line') and whenever the line is empty again.
  function onKeypress() {
    if (!rl || !hint) return;
    if (rl.line === '') { hinted = false; return; }
    if (rl.line === '/' && !hinted) { hinted = true; print(hint); }
  }

  function start({ onLine, onClose }) {
    const opts = { input, output, prompt, terminal: true, historySize: 200 };
    if (typeof completer === 'function') opts.completer = completer;
    rl = readline.createInterface(opts);
    hinted = false;
    input.on('keypress', onKeypress);
    rl.on('line', (line) => { hinted = false; Promise.resolve(onLine(line)).catch(() => {}).then(() => { if (rl) rl.prompt(true); }); });
    rl.on('SIGINT', () => close());
    rl.on('close', () => {
      const wasOpen = !closed;
      closed = true;
      rl = null;
      input.removeListener('keypress', onKeypress);
      if (wasOpen && onClose) onClose();
    });
    rl.prompt();
  }

  /** Closes readline (restores terminal mode) and clears the prompt line. */
  function close() {
    if (!rl) { closed = true; return; }
    const r = rl;
    readline.clearLine(output, 0);
    readline.cursorTo(output, 0);
    r.close(); // emits 'close' → onClose
  }

  function clear() {
    output.write('\x1b[2J\x1b[3J\x1b[H');
    if (rl) rl.prompt(true);
  }

  /**
   * Erase the line the user just submitted (readline has already echoed
   * `> text` and moved to a fresh row). Call it synchronously from `onLine`,
   * before anything else prints — the row above the cursor is then exactly
   * that echo. A long input that wrapped takes several rows; all of them go.
   * Used for lines whose real rendering comes back over the stream, so the
   * feed shows a message once, not "> hi" and then "in  dmitrii  hi".
   */
  function eraseSubmitted(line) {
    if (!rl) return;
    const cols = Math.max(1, output.columns || 80);
    const rows = Math.max(1, Math.ceil((prompt.length + String(line == null ? '' : line).length) / cols));
    for (let i = 0; i < rows; i++) {
      readline.moveCursor(output, 0, -1);
      readline.clearLine(output, 0);
    }
    readline.cursorTo(output, 0);
  }

  /** Remove entries matching `pred` from the in-memory input history (e.g. `/key sc_…`). */
  function scrubHistory(pred) {
    if (rl && Array.isArray(rl.history)) rl.history = rl.history.filter((h) => !pred(h));
  }

  return {
    print,
    start,
    close,
    clear,
    eraseSubmitted,
    scrubHistory,
    get interactive() { return rl !== null; },
  };
}
