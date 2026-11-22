import { existsSync, realpathSync } from 'node:fs';
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

// Where an absolute program path may point; a path elsewhere (`./tools/cat`) is any program.
const SYSTEM_BIN = /^\/(usr\/(local\/)?)?bin\/[^/]+$|^\/opt\/homebrew\/bin\/[^/]+$/;

/** The name of a program run from PATH or a system directory; undefined for any other path. */
function programName(program: string): string | undefined {
  if (!program.includes('/')) return program;
  return SYSTEM_BIN.test(program) ? program.slice(program.lastIndexOf('/') + 1) : undefined;
}

function readerCommand(words: string[]): boolean {
  const [program, ...args] = words;
  const name = program && programName(program);
  if (!name) return false;
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
  // Following symlinks could read outside the project.
  if (name === 'find') return !args.some((arg) => FIND_WRITERS.has(arg) || arg === '-L' || arg === '-follow');
  if (name === 'sed') {
    // Only `sed -n '<lines>p'`: other scripts can write (`w`) or run (`e`).
    const [flag, script, ...files] = args;
    return flag === '-n' && !!script && /^\d+(,\d+|,\$)?p$/.test(script) && files.every((f) => !f.startsWith('-'));
  }
  if (name === 'sort')
    return !args.some((arg) => /^-[a-zA-Z]*o/.test(arg) || arg.startsWith('--output') || arg.startsWith('--compress'));
  if (name === 'rg')
    return !args.some(
      (arg) => arg === '--pre' || arg.startsWith('--pre=') || arg === '--follow' || /^-[a-zA-Z]*L/.test(arg),
    );
  if (name === 'grep' || name === 'egrep' || name === 'fgrep')
    return !args.some((arg) => /^-[a-zA-Z]*R/.test(arg) || arg === '--dereference-recursive');
  if (name === 'tree') return !args.includes('-o') && !args.includes('-l');
  return READERS.has(name);
}

/** `target` with every existing part of it resolved through symlinks. */
function realTarget(target: string): string {
  let existing = target;
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  try {
    return path.join(realpathSync(existing), ...rest);
  } catch {
    return target;
  }
}

function within(target: string, root: string): boolean {
  return target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/** A path argument that reaches outside `root` (or under `~`), symlinks followed. */
function outside(word: string, base: string, root: string): boolean {
  for (const value of new Set([word, word.slice(word.indexOf('=') + 1)])) {
    if (!value) continue;
    if (value.startsWith('~')) return true;
    if (value === '/dev/null') continue;
    // A glob reads what its fixed part names.
    const fixed = value.split(/[\\/]/);
    const glob = fixed.findIndex((part) => /[*?[]/.test(part));
    const target = path.resolve(base, glob < 0 ? value : fixed.slice(0, glob).join('/') || '.');
    if (!within(target, root) || !within(realTarget(target), root)) return true;
  }
  return false;
}

/**
 * Whether every command of `command` (joined by `&&`, `||` or `|`) only reads, and only inside
 * `cwd`: no expansion, redirection or command that writes, and no path outside it.
 */
export function isReadOnlyCommand(command: string | readonly string[], cwd: string): boolean {
  const root = realTarget(path.resolve(cwd));
  return readsOnly(command, root, root);
}

function readsOnly(command: string | readonly string[], base: string, root: string): boolean {
  let parts: string[][];
  if (Array.isArray(command)) parts = [[...command]];
  else {
    const tokens = tokenize(command as string);
    if (!tokens?.length) return false;
    parts = [[]];
    for (const token of tokens) {
      if ('op' in token) {
        if (!parts[parts.length - 1]!.length) return false;
        parts.push([]);
      } else parts[parts.length - 1]!.push(token.word);
    }
  }
  for (const words of parts) {
    if (!words.length) return false;
    const name = programName(words[0]!);
    // `bash -lc '<command>'`, as Codex runs every command.
    if (name && SHELLS.has(name)) {
      if (words.length !== 3 || !/^-l?c$|^-cl$/.test(words[1]!) || !readsOnly(words[2]!, base, root)) return false;
      continue;
    }
    if (words.slice(1).some((word) => outside(word, base, root))) return false;
    if (!readerCommand(words)) return false;
    // Later commands run where `cd` went.
    if (name === 'cd') {
      if (words.length !== 2) return false;
      base = realTarget(path.resolve(base, words[1]!));
    }
  }
  return true;
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

// Where the agent says the command runs (Codex: `cwd`); several different ones count as none.
function commandDirectory(value: unknown, depth = 0, found = new Set<unknown>()): Set<unknown> {
  if (!value || typeof value !== 'object' || depth > 4) return found;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/^(cwd|workdir|working_?directory|Cwd)$/i.test(key)) found.add(item);
    else commandDirectory(item, depth + 1, found);
  }
  return found;
}

/** A request to run a command that only reads inside `cwd`, by `isReadOnlyCommand`. */
export function isReadOnlyApproval(request: ApprovalRequest, cwd: string): boolean {
  const command = approvalCommand(request);
  if (command === undefined || escapesSandbox(request.detail)) return false;
  const root = realTarget(path.resolve(cwd));
  const dirs = [...commandDirectory(request.detail)];
  if (dirs.length > 1 || (dirs.length === 1 && (typeof dirs[0] !== 'string' || !dirs[0]))) return false;
  const base = dirs.length ? realTarget(path.resolve(root, dirs[0] as string)) : root;
  return within(base, root) && readsOnly(command, base, root);
}
