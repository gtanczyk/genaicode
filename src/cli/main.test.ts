import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent } from '../agents/types.js';
import { parseCli, UsageError } from './args.js';
import { EXIT_ABORTED, EXIT_FAILED, EXIT_OK, EXIT_USAGE, helpText, main, type CliEnvironment } from './main.js';

const completed: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null, text: 'Done.' };

function fakeAgent(
  name: string,
  attempts: Array<{ events: AgentEvent[]; result: AgentResult }>,
): CodingAgent & {
  tasks: AgentTask[];
} {
  const tasks: AgentTask[] = [];
  return {
    name,
    command: `${name}-cli`,
    capabilities: {},
    tasks,
    run(task): AgentRun {
      tasks.push(task);
      const { events, result } = attempts[Math.min(tasks.length - 1, attempts.length - 1)];
      return {
        result: Promise.resolve(result),
        abort() {},
        async *[Symbol.asyncIterator]() {
          yield* events;
          yield { type: 'done', result };
        },
      };
    },
  };
}

function environment(overrides: Partial<CliEnvironment> & { argv: string[] }) {
  let stdout = '';
  let stderr = '';
  const cli: CliEnvironment = {
    env: { PATH: '' },
    cwd: '/work',
    stdout: { write: (text: string) => (stdout += text) },
    stderr: { write: (text: string) => (stderr += text) },
    readStdin: async () => undefined,
    ...overrides,
  };
  return { cli, out: () => stdout, err: () => stderr };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A PATH directory holding an executable named `command`. */
function pathWith(command: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'genaicode-cli-'));
  dirs.push(dir);
  writeFileSync(join(dir, command), '#!/bin/sh\n', { mode: 0o755 });
  return dir;
}

describe('parseCli', () => {
  it('parses run options', () => {
    expect(
      parseCli(['run', '-a', 'codex', '--timeout', '90', '--max-turns', '5', '--verify', 'npm test', 'fix', 'it']),
    ).toEqual({
      kind: 'run',
      prompt: 'fix it',
      agent: 'codex',
      cwd: undefined,
      model: undefined,
      effort: undefined,
      maxTurns: 5,
      resume: undefined,
      timeoutMs: 90_000,
      verify: 'npm test',
      maxRepairs: 2,
      json: false,
    });
  });

  it('parses --resume', () => {
    expect(parseCli(['run', '-r', 'abc', 'go on'])).toMatchObject({ resume: 'abc', prompt: 'go on' });
  });

  it('treats a missing or "-" prompt as stdin', () => {
    expect(parseCli(['run'])).toMatchObject({ prompt: undefined });
    expect(parseCli(['run', '-'])).toMatchObject({ prompt: undefined });
  });

  it('rejects unknown commands, flags, and bad numbers', () => {
    expect(() => parseCli(['serve'])).toThrow(UsageError);
    expect(() => parseCli(['run', '--nope', 'x'])).toThrow(UsageError);
    expect(() => parseCli(['run', '--timeout', 'soon', 'x'])).toThrow(/--timeout/);
    expect(() => parseCli(['agents', 'extra'])).toThrow(UsageError);
  });
});

describe('genaicode CLI', () => {
  it('prints help with the 1.x fallback', async () => {
    const { cli, out } = environment({ argv: [] });
    expect(await main(cli)).toBe(EXIT_OK);
    expect(out()).toBe(helpText);
    expect(out()).toContain('npx genaicode@1');
    expect(out()).toContain('github.com/gtanczyk/genaicode/tree/1.x');
  });

  it('exits 2 on a usage error', async () => {
    const { cli, err } = environment({ argv: ['frobnicate'] });
    expect(await main(cli)).toBe(EXIT_USAGE);
    expect(err()).toContain('Unknown command: frobnicate');
  });

  it('lists agents with their install state', async () => {
    const { cli, out } = environment({
      argv: ['agents', '--json'],
      env: { PATH: pathWith('beta-cli') },
      agents: [fakeAgent('alpha', []), fakeAgent('beta', [])],
    });
    expect(await main(cli)).toBe(EXIT_OK);
    const rows = out()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(rows[0]).toEqual({ name: 'alpha', command: 'alpha-cli', path: null });
    expect(rows[1]).toMatchObject({ name: 'beta', command: 'beta-cli' });
    expect(rows[1].path).toMatch(/beta-cli$/);
  });

  it('runs the first installed agent and prints text once', async () => {
    const alpha = fakeAgent('alpha', []);
    const beta = fakeAgent('beta', [
      {
        events: [
          { type: 'tool-start', name: 'shell', input: { command: 'ls -la' } },
          { type: 'text-delta', text: 'Hel' },
          { type: 'text-delta', text: 'lo' },
          { type: 'message', text: 'Hello' },
          { type: 'file-change', paths: ['a.ts'] },
        ],
        result: completed,
      },
    ]);
    const { cli, out, err } = environment({
      argv: ['run', '--timeout', '5', 'say', 'hi'],
      env: { PATH: pathWith('beta-cli') },
      agents: [alpha, beta],
    });
    expect(await main(cli)).toBe(EXIT_OK);
    expect(alpha.tasks).toEqual([]);
    expect(beta.tasks[0]).toMatchObject({ prompt: 'say hi', cwd: '/work', timeoutMs: 5000 });
    expect(out()).toBe('Hello\n');
    expect(err()).toContain('› shell ls -la');
    expect(err()).toContain('✎ a.ts');
    expect(err()).toContain('beta: completed');
  });

  it('reads the prompt from stdin and streams JSON events', async () => {
    const agent = fakeAgent('alpha', [{ events: [{ type: 'message', text: 'ok' }], result: completed }]);
    const { cli, out, err } = environment({
      argv: ['run', '--agent', 'alpha', '--json', '-C', 'sub'],
      agents: [agent],
      readStdin: async () => '  from stdin \n',
    });
    expect(await main(cli)).toBe(EXIT_OK);
    expect(agent.tasks[0]).toMatchObject({ prompt: 'from stdin', cwd: '/work/sub' });
    expect(
      out()
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).type),
    ).toEqual(['message', 'done']);
    expect(err()).toBe('');
  });

  it('fails clearly without a prompt, an unknown agent, or any installed agent', async () => {
    const none = environment({ argv: ['run'], agents: [fakeAgent('alpha', [])] });
    expect(await main(none.cli)).toBe(EXIT_USAGE);
    expect(none.err()).toContain('No prompt');

    const unknown = environment({ argv: ['run', '-a', 'zeta', 'x'], agents: [fakeAgent('alpha', [])] });
    expect(await main(unknown.cli)).toBe(EXIT_USAGE);
    expect(unknown.err()).toContain('Unknown agent "zeta". Known agents: alpha.');

    const missing = environment({ argv: ['run', 'x'], agents: [fakeAgent('alpha', [])] });
    expect(await main(missing.cli)).toBe(EXIT_USAGE);
    expect(missing.err()).toContain('Install one of: alpha-cli');
  });

  it('maps failed and aborted results to exit codes', async () => {
    const failed = environment({
      argv: ['run', '-a', 'alpha', 'x'],
      agents: [
        fakeAgent('alpha', [{ events: [], result: { ...completed, status: 'failed', ok: false, error: 'boom' } }]),
      ],
    });
    expect(await main(failed.cli)).toBe(EXIT_FAILED);
    expect(failed.err()).toContain('boom');

    const aborted = environment({
      argv: ['run', '-a', 'alpha', 'x'],
      agents: [fakeAgent('alpha', [{ events: [], result: { ...completed, status: 'aborted', ok: false } }])],
    });
    expect(await main(aborted.cli)).toBe(EXIT_ABORTED);
  });

  it('sends a failed check back to the agent', async () => {
    const agent = fakeAgent('alpha', [{ events: [], result: completed }]);
    const checks: string[] = [];
    const { cli, err } = environment({
      argv: ['run', '-a', 'alpha', '--verify', 'npm test', 'add feature'],
      agents: [agent],
      runCheck: async (command, cwd) => {
        checks.push(`${command}@${cwd}`);
        return checks.length === 1 ? { exitCode: 1, output: 'expected 2, got 3' } : { exitCode: 0, output: '' };
      },
    });
    expect(await main(cli)).toBe(EXIT_OK);
    expect(checks).toEqual(['npm test@/work', 'npm test@/work']);
    expect(agent.tasks).toHaveLength(2);
    expect(agent.tasks[1].prompt).toContain('expected 2, got 3');
    expect(err()).toContain('verify: failed (exit 1)');
    expect(err()).toContain('verify: passed');
  });

  it('gives up after --max-repairs', async () => {
    const agent = fakeAgent('alpha', [{ events: [], result: completed }]);
    const { cli, out } = environment({
      argv: ['run', '-a', 'alpha', '--verify', 'false', '--max-repairs', '0', '--json', 'x'],
      agents: [agent],
      runCheck: async () => ({ exitCode: 1, output: 'nope' }),
    });
    expect(await main(cli)).toBe(EXIT_FAILED);
    expect(agent.tasks).toHaveLength(1);
    expect(out()).toContain('{"type":"verify","attempt":0,"ok":false,"exitCode":1}');
  });

  it('runs the default --verify command in a shell', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genaicode-verify-'));
    dirs.push(dir);
    const agent = fakeAgent('alpha', [{ events: [], result: completed }]);
    const { cli } = environment({
      argv: ['run', '-a', 'alpha', '--verify', 'echo checked > marker && exit 3', '--max-repairs', '0', 'x'],
      cwd: dir,
      env: process.env,
      agents: [agent],
    });
    expect(await main(cli)).toBe(EXIT_FAILED);
    expect(readFileSync(join(dir, 'marker'), 'utf8').trim()).toBe('checked');
  });
});
