// Tab completion for the `> ` prompt. Pure: (line, { commands, nicks }) →
// [matches, prefix], the shape readline's `completer` option expects. `line`
// is the input up to the cursor; `prefix` is the part of it that the matches
// replace (readline appends what the common prefix adds beyond it).
export const COMMANDS = ['/help', '/r ', '/dm ', '/top', '/who', '/key ', '/notify ', '/clear', '/quit'];
export const NOTIFY_ARGS = ['mentions', 'all', 'off'];
export const KEY_ARGS = ['off'];
const NONE = [[], ''];

function startsWithFold(s, prefix) {
  return s.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
}

/** `@ki` under the cursor → `@kira ` (unique nicks, caller's order, case-insensitive). */
function completeNick(line, nicks) {
  const token = line.slice(line.search(/\S*$/));
  if (token[0] !== '@') return NONE;
  const want = token.slice(1);
  const seen = new Set();
  const matches = [];
  for (const raw of nicks || []) {
    const nick = String(raw == null ? '' : raw);
    if (!nick || seen.has(nick) || !startsWithFold(nick, want)) continue;
    seen.add(nick);
    matches.push(`@${nick} `);
  }
  return [matches, token];
}

export function complete(line, { commands = COMMANDS, nicks = [] } = {}) {
  const s = String(line == null ? '' : line);
  if (s[0] === '/') {
    const sp = s.search(/\s/);
    if (sp < 0) return [commands.filter((c) => startsWithFold(c, s)), s]; // still typing the command
    const cmd = s.slice(0, sp).toLowerCase();
    const arg = s.slice(sp).trimStart();
    const args = cmd === '/notify' ? NOTIFY_ARGS : cmd === '/key' ? KEY_ARGS : null;
    if (args && !/\s/.test(arg)) return [args.filter((a) => startsWithFold(a, arg)), arg];
  }
  return completeNick(s, nicks);
}
