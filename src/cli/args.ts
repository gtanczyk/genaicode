import { parseArgs } from 'node:util';
import { isSandboxPolicy } from '../agents/permissions.js';
import type { AgentBudget, McpServer, SandboxPolicy } from '../agents/types.js';

export type PackSpec = { auto: true; maxParallel?: number } | { lead: string; members: string[]; maxParallel?: number };

export type CliCommand =
  | { kind: 'help' }
  | { kind: 'version' }
  | {
      kind: 'update';
      /** `--check`: only say whether a newer version exists. */
      check: boolean;
      /** `--version <v>`: install this one instead of the latest. */
      version?: string;
      /** `--auto on|off`. */
      auto?: boolean;
      /** Run by the command itself when a day has passed since the last check. */
      background: boolean;
    }
  /** Run once by scripts/install.sh from the freshly installed version. */
  | { kind: 'self-install'; binDir?: string; force: boolean }
  /** `npx genaicode install`: what scripts/install.sh does, from npm. */
  | { kind: 'install'; version?: string; binDir?: string; force: boolean }
  | { kind: 'agents'; json: boolean }
  | { kind: 'send'; id: string; prompt?: string; agent?: string; sandbox?: SandboxPolicy; detach: boolean }
  | {
      kind: 'sessions';
      json: boolean;
      agent?: string;
      cwd?: string;
      /** `--cloud`: also the vendor clouds this environment has keys for. */
      cloud: boolean;
      /** `--since 7d`: only sessions active in this many milliseconds. */
      sinceMs?: number;
      limit: number;
      /** `--waiting`: only the sessions whose next move is yours, approvals first. */
      waiting?: true;
      /** `--archived`: the archived sessions too (`sessions archive`). */
      archived?: true;
      /** Also the sessions nobody typed into (scheduled tasks, headless runs). */
      automated?: true;
      /** `--watch`: keep looking, and print the waiting sessions again whenever they change. */
      watch?: true;
      /** `--exit-with-stdin`: `--watch` ends when its stdin closes, so it cannot outlive the app that started it. */
      exitWithStdin?: true;
    }
  /** `sessions archive|unarchive`: put sessions away, or bring them back; `stale`: all those left for `olderMs`. */
  | { kind: 'archive'; ids: string[]; archived: boolean; stale: boolean; olderMs?: number; agent?: string }
  /** `sessions doctor`: whether the session stores still read as expected. */
  | { kind: 'doctor'; json: boolean; api: boolean; agent?: string; sinceMs?: number }
  /** `sessions mcp`: the session index as an MCP server on stdio. */
  | { kind: 'sessions-mcp'; agent?: string }
  | {
      kind: 'hooks';
      action: 'status' | 'install' | 'uninstall';
      agent?: string;
      /** `install --answer`: questions can also be answered from the tower. */
      answer?: true;
    }
  /** `sessions approve|deny <id>`: answer a question a session holds open. */
  | { kind: 'answer'; id: string; behavior: 'allow' | 'deny'; message?: string }
  /** `limits`: each agent's plan limits as last seen; `record` keeps Claude Code's status line input. */
  | { kind: 'limits'; action: 'show' | 'record'; json: boolean }
  /** `notify`: desktop notifications when a session asks for approval (`--done`: or finishes a turn). */
  | { kind: 'notify'; action: 'status' | 'on' | 'off' | 'test'; done: boolean }
  | {
      kind: 'chat' | 'ui' | 'tower';
      agent?: string;
      pack?: PackSpec;
      verify?: string;
      cwd?: string;
      model?: string;
      effort?: string;
      resume?: string;
      /** `--from <id>`: take over this session of any agent. */
      from?: string;
      approveAll: boolean;
      port?: number;
      open: boolean;
      /** chat: also open the session in the browser. */
      web: boolean;
      /** ui: stop when stdin ends (a host app closes the pipe). */
      exitWithStdin?: boolean;
      /** `--mcp name=url`: HTTP MCP servers attached to every prompt. */
      mcpServers: McpServer[];
      /** `--no-artifacts`. */
      artifacts?: false;
      /** `--sessions`: give the agent the session index (`sessions_list`, `sessions_read`...). */
      sessions?: true;
      /** `--max-tokens`, `--max-cost`: caps on the whole session. */
      budget?: AgentBudget;
      /** `--fallback a,b`: agents a turn moves to when the current one is out. */
      fallback?: string[];
    }
  | {
      kind: 'embed';
      /** What the user wants, in their words, e.g. "only the dev overlay". */
      request?: string;
      agent?: string;
      cwd?: string;
      model?: string;
      effort?: string;
      approveAll: boolean;
      /** Print the prompt instead of starting an agent. */
      print: boolean;
      /** Chat in the browser instead of the terminal. */
      ui: boolean;
      port?: number;
      open: boolean;
    }
  | {
      kind: 'acp';
      agent?: string;
      model?: string;
      effort?: string;
      approveAll: boolean;
    }
  | {
      kind: 'run';
      prompt: string | undefined;
      agent?: string;
      cwd?: string;
      model?: string;
      effort?: string;
      maxTurns?: number;
      resume?: string;
      /** `--from <id>`: take over this session of any agent. */
      from?: string;
      timeoutMs?: number;
      verify?: string;
      maxRepairs: number;
      json: boolean;
      /** `--max-tokens`, `--max-cost`: caps on the run, repairs included. */
      budget?: AgentBudget;
      /** `--fallback a,b`: agents the run moves to when the current one is out. */
      fallback?: string[];
    };

export class UsageError extends Error {}

/** Parse `genaicode` arguments. Throws `UsageError` for anything the help text does not describe. */
export function parseCli(argv: readonly string[]): CliCommand {
  const [command, ...rest] = argv;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') return { kind: 'help' };
  if (command === '--version' || command === '-v') return { kind: 'version' };
  // `genaicode sessions --help`: the help, which covers every command.
  const options = rest.includes('--') ? rest.slice(0, rest.indexOf('--')) : rest;
  if (options.includes('--help') || options.includes('-h')) return { kind: 'help' };

  if (command === 'update') {
    const { values } = parse(() =>
      parseArgs({
        args: rest,
        strict: true,
        options: {
          check: { type: 'boolean' },
          version: { type: 'string' },
          auto: { type: 'string' },
          background: { type: 'boolean' },
        },
      }),
    );
    if (values.auto !== undefined && values.auto !== 'on' && values.auto !== 'off') {
      throw new UsageError('--auto takes "on" or "off".');
    }
    return {
      kind: 'update',
      check: values.check === true,
      version: values.version,
      auto: values.auto === undefined ? undefined : values.auto === 'on',
      background: values.background === true,
    };
  }

  if (command === 'install') {
    const { values } = parse(() =>
      parseArgs({
        args: rest,
        strict: true,
        options: { version: { type: 'string' }, 'bin-dir': { type: 'string' }, force: { type: 'boolean' } },
      }),
    );
    return { kind: 'install', version: values.version, binDir: values['bin-dir'], force: values.force === true };
  }

  if (command === 'self-install') {
    const { values } = parse(() =>
      parseArgs({
        args: rest,
        strict: true,
        options: { 'bin-dir': { type: 'string' }, force: { type: 'boolean' } },
      }),
    );
    return { kind: 'self-install', binDir: values['bin-dir'], force: values.force === true };
  }

  if (command === 'agents') {
    const { values } = parse(() => parseArgs({ args: rest, options: { json: { type: 'boolean' } }, strict: true }));
    return { kind: 'agents', json: values.json === true };
  }

  if (command === 'sessions' && rest[0] === 'send') {
    const { values, positionals } = parse(() =>
      parseArgs({
        args: rest.slice(1),
        strict: true,
        allowPositionals: true,
        options: {
          agent: { type: 'string', short: 'a' },
          sandbox: { type: 'string' },
          detach: { type: 'boolean' },
        },
      }),
    );
    const [id, ...words] = positionals;
    if (!id?.trim()) throw new UsageError('Usage: genaicode sessions send <id> "<prompt>" [--detach]');
    const sandbox = values.sandbox;
    if (sandbox !== undefined && !isSandboxPolicy(sandbox))
      throw new UsageError('--sandbox takes read-only, workspace-write or unrestricted.');
    return {
      kind: 'send',
      id,
      prompt: words.length ? words.join(' ') : undefined,
      agent: values.agent,
      sandbox,
      detach: values.detach === true,
    };
  }

  if (command === 'sessions') {
    const { values, positionals } = parse(() =>
      parseArgs({
        args: rest,
        strict: true,
        allowPositionals: true,
        options: {
          json: { type: 'boolean' },
          cloud: { type: 'boolean' },
          api: { type: 'boolean' },
          agent: { type: 'string', short: 'a' },
          cwd: { type: 'string', short: 'C' },
          since: { type: 'string' },
          limit: { type: 'string', short: 'n' },
          waiting: { type: 'boolean', short: 'w' },
          watch: { type: 'boolean' },
          'exit-with-stdin': { type: 'boolean' },
          message: { type: 'string', short: 'm' },
          archived: { type: 'boolean' },
          automated: { type: 'boolean' },
          stale: { type: 'boolean' },
          older: { type: 'string' },
        },
      }),
    );
    const limit = optionalNumber(values.limit, '--limit');
    if (values.watch && (positionals.length || !values.waiting || !values.json || values.archived)) {
      throw new UsageError('--watch goes with "genaicode sessions --waiting --json".');
    }
    if (values['exit-with-stdin'] && !values.watch) throw new UsageError('--exit-with-stdin goes with --watch.');
    if (positionals[0] === 'approve' || positionals[0] === 'deny') {
      const deny = positionals[0] === 'deny';
      const extra =
        values.cloud ||
        values.cwd !== undefined ||
        values.limit !== undefined ||
        values.since !== undefined ||
        values.agent !== undefined ||
        values.json ||
        values.api ||
        values.waiting ||
        values.archived ||
        values.stale ||
        values.older !== undefined;
      if (positionals.length !== 2 || extra || (!deny && values.message !== undefined)) {
        throw new UsageError('Usage: genaicode sessions approve <question> | sessions deny <question> [-m <why>]');
      }
      return {
        kind: 'answer',
        id: positionals[1]!,
        behavior: deny ? 'deny' : 'allow',
        ...(values.message !== undefined ? { message: values.message } : {}),
      };
    }
    if (values.message !== undefined) throw new UsageError('-m belongs to "genaicode sessions deny".');
    if (positionals[0] === 'archive' || positionals[0] === 'unarchive') {
      const archived = positionals[0] === 'archive';
      const ids = positionals.slice(1);
      const extra =
        values.cloud ||
        values.cwd !== undefined ||
        values.limit !== undefined ||
        values.since !== undefined ||
        values.json ||
        values.api ||
        values.waiting ||
        values.archived;
      const stale = values.stale === true;
      if (extra || (!archived && (stale || values.older !== undefined)) || (stale ? ids.length > 0 : !ids.length)) {
        throw new UsageError(
          'Usage: genaicode sessions archive <id...> | sessions archive --stale [--older 2d] [-a <agent>] | sessions unarchive <id...>',
        );
      }
      if (values.older !== undefined && !stale) throw new UsageError('--older goes with "sessions archive --stale".');
      return {
        kind: 'archive',
        ids,
        archived,
        stale,
        ...(values.older !== undefined ? { olderMs: durationOf(values.older) } : {}),
        ...(values.agent !== undefined ? { agent: values.agent } : {}),
      };
    }
    if (values.stale || values.older !== undefined)
      throw new UsageError('--stale and --older go with "sessions archive".');
    if (positionals[0] === 'mcp') {
      const extra =
        values.cloud || values.cwd !== undefined || values.limit !== undefined || values.since !== undefined;
      if (positionals.length > 1 || extra || values.json || values.api || values.waiting || values.archived) {
        throw new UsageError('Usage: genaicode sessions mcp [-a <agent>]');
      }
      return { kind: 'sessions-mcp', ...(values.agent !== undefined ? { agent: values.agent } : {}) };
    }
    if (positionals.length) {
      const extra =
        values.cloud || values.cwd !== undefined || values.limit !== undefined || values.waiting || values.archived;
      if (positionals.length > 1 || positionals[0] !== 'doctor' || extra) {
        throw new UsageError(
          'Usage: genaicode sessions [doctor|mcp] [options]. "doctor" takes -a, --since and --json.',
        );
      }
      return {
        kind: 'doctor',
        json: values.json === true,
        api: values.api === true,
        ...(values.agent !== undefined ? { agent: values.agent } : {}),
        ...(values.since !== undefined ? { sinceMs: durationOf(values.since) } : {}),
      };
    }
    if (values.api) throw new UsageError('--api belongs to "genaicode sessions doctor".');
    return {
      kind: 'sessions',
      json: values.json === true,
      cloud: values.cloud === true,
      ...(values.agent !== undefined ? { agent: values.agent } : {}),
      ...(values.cwd !== undefined ? { cwd: values.cwd } : {}),
      ...(values.since !== undefined ? { sinceMs: durationOf(values.since) } : {}),
      limit: limit ?? 30,
      ...(values.waiting === true ? { waiting: true } : {}),
      ...(values.archived === true ? { archived: true } : {}),
      ...(values.automated === true ? { automated: true } : {}),
      ...(values.watch === true ? { watch: true } : {}),
      ...(values['exit-with-stdin'] === true ? { exitWithStdin: true } : {}),
    };
  }

  if (command === 'limits') {
    const { values, positionals } = parse(() =>
      parseArgs({
        args: rest,
        strict: true,
        allowPositionals: true,
        // `--genaicode-live` marks the status line `hooks install` sets, so it can be found again.
        options: { json: { type: 'boolean' }, 'genaicode-live': { type: 'boolean' } },
      }),
    );
    const action = positionals[0] ?? 'show';
    if (positionals.length > 1 || (action !== 'show' && action !== 'record') || (values.json && action === 'record')) {
      throw new UsageError('Usage: genaicode limits [--json] | genaicode limits record');
    }
    return { kind: 'limits', action, json: values.json === true };
  }

  if (command === 'notify') {
    const { values, positionals } = parse(() =>
      parseArgs({ args: rest, strict: true, allowPositionals: true, options: { done: { type: 'boolean' } } }),
    );
    const action = positionals[0] ?? 'status';
    const known = ['status', 'on', 'off', 'test'];
    if (positionals.length > 1 || !known.includes(action) || (values.done && action !== 'on')) {
      throw new UsageError('Usage: genaicode notify [status|on [--done]|off|test]');
    }
    return { kind: 'notify', action: action as 'status' | 'on' | 'off' | 'test', done: values.done === true };
  }

  if (command === 'hooks') {
    const { values, positionals } = parse(() =>
      parseArgs({
        args: rest,
        strict: true,
        allowPositionals: true,
        options: { agent: { type: 'string', short: 'a' }, answer: { type: 'boolean' } },
      }),
    );
    const action = positionals[0] ?? 'status';
    const known = action === 'status' || action === 'install' || action === 'uninstall';
    if (positionals.length > 1 || !known || (values.answer && action !== 'install')) {
      throw new UsageError('Usage: genaicode hooks [status|install [--answer]|uninstall] [-a <agent>]');
    }
    return {
      kind: 'hooks',
      action,
      ...(values.agent !== undefined ? { agent: values.agent } : {}),
      ...(values.answer === true ? { answer: true } : {}),
    };
  }

  if (command === 'chat' || command === 'ui' || command === 'tower') {
    const parseOptions = {
      agent: { type: 'string' as const, short: 'a' },
      pack: { type: 'string' as const },
      'max-parallel': { type: 'string' as const },
      verify: { type: 'string' as const },
      cwd: { type: 'string' as const, short: 'C' },
      model: { type: 'string' as const, short: 'm' },
      effort: { type: 'string' as const },
      resume: { type: 'string' as const, short: 'r' },
      from: { type: 'string' as const },
      yes: { type: 'boolean' as const, short: 'y' },
      port: { type: 'string' as const },
      mcp: { type: 'string' as const, multiple: true as const },
      'max-tokens': { type: 'string' as const },
      'max-cost': { type: 'string' as const },
      fallback: { type: 'string' as const, multiple: true as const },
      'no-artifacts': { type: 'boolean' as const },
      sessions: { type: 'boolean' as const },
      ...(command === 'ui'
        ? { 'no-open': { type: 'boolean' as const }, 'exit-with-stdin': { type: 'boolean' as const } }
        : { web: { type: 'boolean' as const } }),
    };
    const { args, barePack, explicitPack } = extractBarePack(rest, parseOptions);
    if (barePack && explicitPack) {
      throw new UsageError('Use --pack once, either by itself or with lead:member[,member].');
    }
    const { values } = parse(() =>
      parseArgs({
        args,
        strict: true,
        options: parseOptions,
      }),
    );
    const extra = values as { 'no-open'?: boolean; web?: boolean; 'exit-with-stdin'?: boolean };
    const maxParallel = optionalNumber(values['max-parallel'], '--max-parallel');
    let pack: PackSpec | undefined;
    if (barePack) {
      if (maxParallel === 0) throw new UsageError('--max-parallel must be at least 1.');
      pack = { auto: true, ...(maxParallel !== undefined ? { maxParallel } : {}) };
    } else if (typeof values.pack === 'string') {
      const [lead, list, ...extraParts] = values.pack.split(':');
      const members = list?.split(',').map((name) => name.trim());
      if (!lead.trim() || !members?.length || members.some((name) => !name) || extraParts.length)
        throw new UsageError(
          '--pack takes no value (auto-detect installed agents) or lead:member[,member], for example claude:codex,gemini.',
        );
      if (values.agent !== undefined && values.agent !== lead.trim())
        throw new UsageError('--pack already chooses the lead agent. Use the same name with --agent or omit it.');
      if (maxParallel === 0) throw new UsageError('--max-parallel must be at least 1.');
      pack = { lead: lead.trim(), members: [...new Set(members)], maxParallel };
    } else if (maxParallel !== undefined) throw new UsageError('--max-parallel requires --pack.');
    if (values.verify !== undefined && (!pack || !values.verify.trim()))
      throw new UsageError('--verify needs --pack and a nonempty test command.');
    const port = optionalNumber(values.port, '--port');
    if (port !== undefined && port > 65535) throw new UsageError(`--port expects 0-65535, got ${port}.`);
    return {
      kind: command,
      ...(pack ? { pack } : {}),
      ...(values.verify !== undefined ? { verify: values.verify } : {}),
      agent: values.agent,
      cwd: values.cwd,
      model: values.model,
      effort: values.effort,
      resume: values.resume,
      ...(values.from ? { from: values.from } : {}),
      approveAll: values.yes === true,
      port,
      open: extra['no-open'] !== true,
      web: extra.web === true,
      exitWithStdin: extra['exit-with-stdin'] === true,
      mcpServers: (values.mcp ?? []).map(parseMcp),
      ...(values['no-artifacts'] === true ? { artifacts: false } : {}),
      ...(command === 'tower' || values.sessions === true ? { sessions: true } : {}),
      ...budgetOf(values),
      ...fallbackOf(values.fallback),
    };
  }

  if (command === 'embed') {
    const { values, positionals } = parse(() =>
      parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: {
          agent: { type: 'string', short: 'a' },
          cwd: { type: 'string', short: 'C' },
          model: { type: 'string', short: 'm' },
          effort: { type: 'string' },
          yes: { type: 'boolean', short: 'y' },
          print: { type: 'boolean' },
          ui: { type: 'boolean' },
          port: { type: 'string' },
          'no-open': { type: 'boolean' },
        },
      }),
    );
    const request = positionals.join(' ').trim();
    const port = optionalNumber(values.port, '--port');
    if (port !== undefined && port > 65535) throw new UsageError(`--port expects 0-65535, got ${port}.`);
    return {
      kind: 'embed',
      request: request || undefined,
      agent: values.agent,
      cwd: values.cwd,
      model: values.model,
      effort: values.effort,
      approveAll: values.yes === true,
      print: values.print === true,
      ui: values.ui === true,
      port,
      open: values['no-open'] !== true,
    };
  }

  if (command === 'acp') {
    const { values } = parse(() =>
      parseArgs({
        args: rest,
        strict: true,
        options: {
          agent: { type: 'string', short: 'a' },
          model: { type: 'string', short: 'm' },
          effort: { type: 'string' },
          yes: { type: 'boolean', short: 'y' },
        },
      }),
    );
    return {
      kind: 'acp',
      agent: values.agent,
      model: values.model,
      effort: values.effort,
      approveAll: values.yes === true,
    };
  }

  if (command === 'run') {
    const { values, positionals } = parse(() =>
      parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: {
          agent: { type: 'string', short: 'a' },
          cwd: { type: 'string', short: 'C' },
          model: { type: 'string', short: 'm' },
          effort: { type: 'string' },
          'max-turns': { type: 'string' },
          resume: { type: 'string', short: 'r' },
          from: { type: 'string' },
          timeout: { type: 'string' },
          verify: { type: 'string' },
          'max-repairs': { type: 'string' },
          json: { type: 'boolean' },
          'max-tokens': { type: 'string' },
          'max-cost': { type: 'string' },
          fallback: { type: 'string', multiple: true },
        },
      }),
    );
    const prompt = positionals.join(' ').trim();
    const timeout = optionalNumber(values.timeout, '--timeout');
    return {
      kind: 'run',
      prompt: prompt === '' || prompt === '-' ? undefined : prompt,
      agent: values.agent,
      cwd: values.cwd,
      model: values.model,
      effort: values.effort,
      maxTurns: optionalNumber(values['max-turns'], '--max-turns'),
      resume: values.resume,
      ...(values.from ? { from: values.from } : {}),
      timeoutMs: timeout === undefined ? undefined : timeout * 1000,
      verify: values.verify,
      maxRepairs: optionalNumber(values['max-repairs'], '--max-repairs') ?? 2,
      json: values.json === true,
      ...budgetOf(values),
      ...fallbackOf(values.fallback),
    };
  }

  throw new UsageError(`Unknown command: ${command}`);
}

/** Run a `parseArgs` call, reporting its errors as usage errors. */
/** `--mcp name=url`: an MCP server over streamable HTTP. */
function parseMcp(value: string): McpServer {
  const match = /^([\w-]+)=(https?:\/\/\S+)$/.exec(value);
  if (!match) throw new UsageError(`--mcp expects name=http(s)://url, got "${value}".`);
  return { name: match[1]!, url: match[2]! };
}

const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 };

/** `--since 90m`, `12h`, `7d`, `2w` in milliseconds. */
function durationOf(value: string): number {
  const match = /^(\d+)([mhdw])$/.exec(value);
  if (!match) throw new UsageError('--since expects a number and a unit, e.g. 90m, 12h, 7d or 2w.');
  return Number(match[1]) * UNIT_MS[match[2]!]!;
}

function parse<T>(call: () => T): T {
  try {
    return call();
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

/** `--fallback codex,gemini` (repeatable) as a list of agent names, when given. */
function fallbackOf(values: readonly string[] | undefined): { fallback?: string[] } {
  if (!values) return {};
  const names = values.flatMap((value) => value.split(/[\s,]+/)).filter(Boolean);
  if (!names.length) throw new UsageError('--fallback expects agent names, e.g. --fallback codex,gemini.');
  return { fallback: [...new Set(names)] };
}

/** `--max-tokens <n>` and `--max-cost <usd>` as a budget, when either is given. */
function budgetOf(values: { 'max-tokens'?: string; 'max-cost'?: string }): { budget?: AgentBudget } {
  const maxTokens = optionalNumber(values['max-tokens'], '--max-tokens');
  const cost = values['max-cost'];
  let maxCostUsd: number | undefined;
  if (cost !== undefined) {
    maxCostUsd = Number(cost.replace(/^\$/, ''));
    if (cost.trim() === '' || !Number.isFinite(maxCostUsd) || maxCostUsd <= 0)
      throw new UsageError(`--max-cost expects a dollar amount above 0, got "${cost}".`);
  }
  if (maxTokens === undefined && maxCostUsd === undefined) return {};
  return {
    budget: {
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
    },
  };
}

function optionalNumber(value: string | boolean | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (typeof value !== 'string' || value.trim() === '' || !Number.isInteger(number) || number < 0) {
    throw new UsageError(`${flag} expects a non-negative whole number, got "${String(value)}".`);
  }
  return number;
}

/**
 * Strip a bare `--pack` (no value, or followed by another flag) before `parseArgs`, since Node's
 * `parseArgs` does not support optional values on string options. Values of other string options
 * (such as `-m --pack`) are left untouched.
 */
function extractBarePack(
  rest: readonly string[],
  options: Record<string, { type: 'string' | 'boolean'; short?: string }>,
): { args: string[]; barePack: boolean; explicitPack: boolean } {
  const longValueOpts = new Set<string>();
  const shortValueOpts = new Set<string>();
  for (const [name, config] of Object.entries(options)) {
    if (config.type !== 'string' || name === 'pack') continue;
    longValueOpts.add(`--${name}`);
    if (config.short) shortValueOpts.add(config.short);
  }
  const args: string[] = [];
  let barePack = false;
  let explicitPack = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--') {
      args.push(...rest.slice(i));
      break;
    }
    if (arg === '--pack') {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('-')) {
        barePack = true;
        continue;
      }
      explicitPack = true;
      args.push(arg, next);
      i++;
      continue;
    }
    if (arg.startsWith('--pack=')) {
      explicitPack = true;
      args.push(arg);
      continue;
    }
    args.push(arg);
    if (takesNextValue(arg, longValueOpts, shortValueOpts) && i + 1 < rest.length) {
      args.push(rest[++i]!);
    }
  }
  return { args, barePack, explicitPack };
}

function takesNextValue(arg: string, longValueOpts: ReadonlySet<string>, shortValueOpts: ReadonlySet<string>): boolean {
  if (arg.startsWith('--')) return longValueOpts.has(arg);
  if (!arg.startsWith('-') || arg.length < 2) return false;
  for (let i = 1; i < arg.length; i++) {
    if (shortValueOpts.has(arg[i]!)) return i === arg.length - 1;
  }
  return false;
}
