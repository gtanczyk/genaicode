import path from 'node:path';
import type { ApprovalRequest } from './types.js';

/**
 * Commands that only read the files and history of a project. A pack lets a delegated agent run
 * them without asking: a review that cannot `ls` or `git log` comes back with nothing.
 */
const READERS = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'pwd',
  'stat',
  'tree',
  'du',
  'basename',
  'dirname',
  'realpath',
  'which',
  'echo',
  'true',
  'nl',
  'cut',
  'sort',
  'uniq',
  'diff',
  'cd',
]);

// Git subcommands that neither write nor run configured programs (no pager: output is piped).
const GIT_READERS = new Set([
  'log',
  'show',
  'diff',
  'status',
  'blame',
  'ls-files',
  'ls-tree',
  'rev-parse',
  'grep',
  'shortlog',
  'describe',
  'cat-file',
]);

// `find` actions that run, write or delete.
const FIND_WRITERS = new Set([
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-delete',
  '-fprint',
  '-fprint0',
  '-fprintf',
  '-fls',
]);

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);

type Token = { word: string } | { op: string };

/** Words and `&&`, `||`, `|`; undefined for anything a reader does not need (expansion, redirection). */
function tokenize(command: string): Token[] | undefined {
  const tokens: Token[] = [];
  let word: string | undefined;
  const end = () => {
    if (word !== undefined) tokens.push({ word });
    word = undefined;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (c === "'") {
      const close = command.indexOf("'", i + 1);
      if (close < 0) return undefined;
      word = (word ?? '') + command.slice(i + 1, close);
      i = close;
    } else if (c === '"') {
      let text = '';
      let j = i + 1;
      for (; j < command.length && command[j] !== '"'; j++) {
        const d = command[j]!;
        if (d === '$' || d === '`') return undefined;
        if (d === '\\' && j + 1 < command.length) text += command[++j];
        else text += d;
      }
      if (j >= command.length) return undefined;
      word = (word ?? '') + text;
      i = j;
    } else if (c === '\\') {
      if (i + 1 >= command.length || command[i + 1] === '\n') return undefined;
      word = (word ?? '') + command[++i];
    } else if (c === ' ' || c === '\t') {
      end();
    } else if (c === '&' || c === '|') {
      end();
      const double = command[i + 1] === c;
      if (c === '&' && !double) return undefined;
      tokens.push({ op: double ? c + c : c });
      if (double) i++;
    } else if (command.startsWith('2>/dev/null', i) && word === undefined) {
      i += '2>/dev/null'.length - 1;
    } else if ('$`;<>()\n\r{}!#'.includes(c)) {
      return undefined;
    } else {
      // Globs and `~` expand to paths, which a reader only reads.
      word = (word ?? '') + c;
    }
  }
  end();
  return tokens;
}

function readerCommand(words: string[]): boolean {
  const [program, ...args] = words;
  if (!program) return false;
  const name = program.includes('/') ? program.slice(program.lastIndexOf('/') + 1) : program;
  if (name === 'git') {
    // Options before the subcommand (`-C dir`, `--no-pager`) only; `-c` could set a program to run.
    let i = 0;
    while (i < args.length && args[i]!.startsWith('-')) {
      const option = args[i]!;
      if (option === '-C') i += 2;
      else if (option === '--no-pager') i += 1;
      else return false;
    }
    const sub = args[i];
    if (!sub) return false;
    const rest = args.slice(i + 1);
    if (
      rest.some((arg) =>
        ['--output', '--ext-diff', '--textconv', '--filters', '-O', '--open-files-in-pager'].some(
          (bad) => arg === bad || arg.startsWith(`${bad}=`) || (bad === '-O' && arg.startsWith('-O')),
        ),
      )
    )
      return false;
    if (sub === 'branch' || sub === 'tag' || sub === 'remote')
      return rest.every((arg) => ['-a', '-r', '-v', '-vv', '--list', '-l', '--show-current'].includes(arg));
    return GIT_READERS.has(sub);
  }
  if (name === 'find') return !args.some((arg) => FIND_WRITERS.has(arg));
  if (name === 'sed') {
    // Only `sed -n '<lines>p'`: other scripts can write (`w`) or run (`e`).
    const [flag, script, ...files] = args;
    return flag === '-n' && !!script && /^\d+(,\d+|,\$)?p$/.test(script) && files.every((f) => !f.startsWith('-'));
  }
  if (name === 'sort')
    return !args.some((arg) => /^-[a-zA-Z]*o/.test(arg) || arg.startsWith('--output') || arg.startsWith('--compress'));
  if (name === 'rg') return !args.some((arg) => arg === '--pre' || arg.startsWith('--pre='));
  if (name === 'tree') return !args.includes('-o');
  return READERS.has(name);
}

/** A path argument outside `cwd` (or under `~`): reading it is not reading the project. */
function outside(word: string, cwd: string): boolean {
  for (const value of [word, word.slice(word.indexOf('=') + 1)]) {
    if (value.startsWith('~')) return true;
    if (value === '/dev/null') continue;
    if (value.startsWith('/') || value.split(/[\\/]/).includes('..')) {
      const resolved = path.resolve(cwd, value);
      if (resolved !== cwd && !resolved.startsWith(cwd.endsWith(path.sep) ? cwd : cwd + path.sep)) return true;
    }
  }
  return false;
}

/**
 * Whether every command of `command` (joined by `&&`, `||` or `|`) only reads, and only inside
 * `cwd`: no expansion, redirection or command that writes, and no path outside it.
 */
export function isReadOnlyCommand(command: string | readonly string[], cwd: string): boolean {
  let words: string[];
  if (Array.isArray(command)) {
    words = [...command];
  } else {
    const tokens = tokenize(command as string);
    if (!tokens?.length) return false;
    const parts: string[][] = [[]];
    for (const token of tokens) {
      if ('op' in token) {
        if (!parts[parts.length - 1]!.length) return false;
        parts.push([]);
      } else parts[parts.length - 1]!.push(token.word);
    }
    if (parts.length > 1) return parts.every((part) => part.length > 0 && isReadOnlyCommand(part, cwd));
    words = parts[0]!;
  }
  if (!words.length) return false;
  // `bash -lc '<command>'`, as Codex runs every command.
  const program = words[0]!;
  const shell = program.includes('/') ? program.slice(program.lastIndexOf('/') + 1) : program;
  if (SHELLS.has(shell)) {
    if (words.length !== 3 || !/^-l?c$|^-cl$/.test(words[1]!)) return false;
    return isReadOnlyCommand(words[2]!, cwd);
  }
  if (words.slice(1).some((word) => outside(word, path.resolve(cwd)))) return false;
  return readerCommand(words);
}

const COMMAND_KEYS = ['command', 'commandLine', 'CommandLine', 'cmd'];

function commandIn(value: unknown, depth: number): string | readonly string[] | undefined {
  if (!value || typeof value !== 'object' || depth > 3) return undefined;
  const object = value as Record<string, unknown>;
  for (const key of COMMAND_KEYS) {
    const found = object[key];
    if (typeof found === 'string' && found.trim()) return found;
    if (Array.isArray(found) && found.length && found.every((part) => typeof part === 'string'))
      return found as string[];
  }
  for (const key of ['input', 'rawInput', 'toolCall', 'params', 'subject', 'arguments']) {
    const found = commandIn(object[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** The shell command an approval asks to run, when the agent's request names it. */
export function approvalCommand(request: ApprovalRequest): string | readonly string[] | undefined {
  if (request.kind !== 'command') return undefined;
  return commandIn(request.detail, 0);
}

// Asks to leave the agent's sandbox (Antigravity's `BypassSandbox`): a person decides that.
function escapesSandbox(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > 4) return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, item]) => (/bypass.?sandbox|escalat/i.test(key) && !!item) || escapesSandbox(item, depth + 1),
  );
}

/** A request to run a command that only reads inside `cwd`, by `isReadOnlyCommand`. */
export function isReadOnlyApproval(request: ApprovalRequest, cwd: string): boolean {
  const command = approvalCommand(request);
  return command !== undefined && !escapesSandbox(request.detail) && isReadOnlyCommand(command, cwd);
}
