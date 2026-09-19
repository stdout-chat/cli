// Readline management: plain scrolling output with a `> ` prompt pinned at the
// bottom. No alternate screen, no curses — works in tmux splits and pipes.
import readline from 'node:readline';

export function createUI({ input = process.stdin, output = process.stdout, prompt = '> ' } = {}) {
  let rl = null;
  let closed = false;

  function print(text) {
    if (closed && !rl) { output.write(`${text}\n`); return; }
    if (rl) {
      readline.clearLine(output, 0);
      readline.cursorTo(output, 0);
    }
    output.write(`${text}\n`);
    if (rl) rl.prompt(true);
  }

  function start({ onLine, onClose }) {
    rl = readline.createInterface({ input, output, prompt, terminal: true, historySize: 200 });
    rl.on('line', (line) => { Promise.resolve(onLine(line)).catch(() => {}).then(() => { if (rl) rl.prompt(true); }); });
    rl.on('SIGINT', () => close());
    rl.on('close', () => {
      const wasOpen = !closed;
      closed = true;
      rl = null;
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

  /** Remove entries matching `pred` from the in-memory input history (e.g. `/key sc_…`). */
  function scrubHistory(pred) {
    if (rl && Array.isArray(rl.history)) rl.history = rl.history.filter((h) => !pred(h));
  }

  return {
    print,
    start,
    close,
    clear,
    scrubHistory,
    get interactive() { return rl !== null; },
  };
}
