import { parseArgs } from 'node:util';

export type CliCommand =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'agents'; json: boolean }
  | {
      kind: 'chat' | 'ui';
      agent?: string;
      cwd?: string;
      model?: string;
      effort?: string;
      resume?: string;
      approveAll: boolean;
      port?: number;
      open: boolean;
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
      timeoutMs?: number;
      verify?: string;
      maxRepairs: number;
      json: boolean;
    };

export class UsageError extends Error {}

/** Parse `genaicode` arguments. Throws `UsageError` for anything the help text does not describe. */
export function parseCli(argv: readonly string[]): CliCommand {
  const [command, ...rest] = argv;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') return { kind: 'help' };
  if (command === '--version' || command === '-v') return { kind: 'version' };

  if (command === 'agents') {
    const { values } = parse(() => parseArgs({ args: rest, options: { json: { type: 'boolean' } }, strict: true }));
    return { kind: 'agents', json: values.json === true };
  }

  if (command === 'chat' || command === 'ui') {
    const { values } = parse(() =>
      parseArgs({
        args: rest,
        strict: true,
        options: {
          agent: { type: 'string', short: 'a' },
          cwd: { type: 'string', short: 'C' },
          model: { type: 'string', short: 'm' },
          effort: { type: 'string' },
          resume: { type: 'string', short: 'r' },
          yes: { type: 'boolean', short: 'y' },
          ...(command === 'ui' ? { port: { type: 'string' as const }, 'no-open': { type: 'boolean' as const } } : {}),
        },
      }),
    );
    const extra = values as { port?: string; 'no-open'?: boolean };
    const port = optionalNumber(extra.port, '--port');
    if (port !== undefined && port > 65535) throw new UsageError(`--port expects 0-65535, got ${port}.`);
    return {
      kind: command,
      agent: values.agent,
      cwd: values.cwd,
      model: values.model,
      effort: values.effort,
      resume: values.resume,
      approveAll: values.yes === true,
      port,
      open: extra['no-open'] !== true,
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
          timeout: { type: 'string' },
          verify: { type: 'string' },
          'max-repairs': { type: 'string' },
          json: { type: 'boolean' },
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
      timeoutMs: timeout === undefined ? undefined : timeout * 1000,
      verify: values.verify,
      maxRepairs: optionalNumber(values['max-repairs'], '--max-repairs') ?? 2,
      json: values.json === true,
    };
  }

  throw new UsageError(`Unknown command: ${command}`);
}

/** Run a `parseArgs` call, reporting its errors as usage errors. */
function parse<T>(call: () => T): T {
  try {
    return call();
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function optionalNumber(value: string | boolean | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (typeof value !== 'string' || value.trim() === '' || !Number.isInteger(number) || number < 0) {
    throw new UsageError(`${flag} expects a non-negative whole number, got "${String(value)}".`);
  }
  return number;
}
