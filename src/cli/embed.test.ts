import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentResult, AgentRun, AgentTask, CodingAgent } from '../agents/types.js';
import { embedPrompt, embedRequest, readEmbedInstructions, stripFrontmatter } from './embed.js';
import { parseCli, UsageError } from './args.js';
import { EXIT_OK, EXIT_USAGE, main, type CliEnvironment, type UiLaunch } from './main.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'genaicode-embed-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

describe('embedPrompt', () => {
  it('puts the shipped skill and the task together', () => {
    const prompt = embedPrompt(readEmbedInstructions(), { cwd: '/work/shop', version: '2.18.0' });
    expect(prompt).not.toMatch(/^---/);
    expect(prompt).toContain('# Embed genaicode in this project');
    expect(prompt).toContain('## Recipe: Vite overlay');
    expect(prompt).toContain('## Recipe: dev overlay without Vite');
    expect(prompt).toContain('Embed genaicode in the project in /work/shop.');
    expect(prompt).toContain('depend on `^2.18.0`');
    expect(prompt).toContain('The user did not say which integration');
    const steered = embedPrompt('x', { cwd: '/w', version: '1.0.0', request: 'only the dev panel' });
    expect(steered).toContain('The user asked: only the dev panel');
    expect(embedRequest('only the dev panel')).toBe('Embed genaicode in this project: only the dev panel');
  });

  it('strips only a leading YAML header', () => {
    expect(stripFrontmatter('---\nname: a\n---\nbody\n---\nmore')).toBe('body\n---\nmore');
    expect(stripFrontmatter('no header')).toBe('no header');
  });

  it('ships a skill Claude Code can load', () => {
    const skill = readEmbedInstructions();
    expect(skill).toMatch(/^---\nname: genaicode-embed\ndescription: .+\n---\n/);
  });
});

describe('genaicode embed', () => {
  it('parses its options', () => {
    expect(parseCli(['embed', '-a', 'claude', '--ui', '--no-open', 'only', 'the', 'in-app', 'agent'])).toEqual({
      kind: 'embed',
      request: 'only the in-app agent',
      agent: 'claude',
      cwd: undefined,
      model: undefined,
      effort: undefined,
      approveAll: false,
      print: false,
      ui: true,
      port: undefined,
      open: false,
    });
    expect(parseCli(['embed'])).toMatchObject({ kind: 'embed', request: undefined });
    expect(() => parseCli(['embed', '--mode', 'vite'])).toThrow(UsageError);
  });

  function environment(cwd: string, argv: string[], overrides: Partial<CliEnvironment> = {}) {
    let stdout = '';
    let stderr = '';
    const cli: CliEnvironment = {
      argv,
      env: { PATH: '' },
      cwd,
      stdout: { write: (text: string) => (stdout += text) },
      stderr: { write: (text: string) => (stderr += text) },
      readStdin: async () => undefined,
      interactive: false,
      ...overrides,
    };
    return { cli, out: () => stdout, err: () => stderr };
  }

  it('prints the prompt with --print', async () => {
    const dir = project({});
    const { cli, out } = environment(dir, ['embed', '--print']);
    expect(await main(cli)).toBe(EXIT_OK);
    expect(out()).toContain(`Embed genaicode in the project in ${dir}.`);
  });

  it('runs the agent headless without a terminal', async () => {
    const dir = project({});
    const tasks: AgentTask[] = [];
    const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null, text: 'Added.' };
    const agent: CodingAgent = {
      name: 'alpha',
      command: 'alpha-cli',
      capabilities: {},
      run(task): AgentRun {
        tasks.push(task);
        return {
          result: Promise.resolve(result),
          abort() {},
          async *[Symbol.asyncIterator]() {
            yield { type: 'done', result };
          },
        };
      },
    };
    const { cli, err } = environment('/', ['embed', '-a', 'alpha', '-C', dir], { agents: [agent] });
    expect(await main(cli)).toBe(EXIT_OK);
    expect(tasks[0].onApproval).toBeUndefined();
    const yes = environment('/', ['embed', '-y', '-a', 'alpha', '-C', dir], { agents: [agent] });
    expect(await main(yes.cli)).toBe(EXIT_OK);
    expect(await tasks[1].onApproval?.({} as never)).toBe('approve');
    tasks.splice(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].cwd).toBe(dir);
    expect(tasks[0].prompt).toContain('## Recipe: Vite overlay');
    expect(err()).toContain(`alpha in ${dir}`);
  });

  it('opens the chat with a short request that the agent gets in full', async () => {
    const dir = project({});
    const launches: Array<{ kind: string; launch: UiLaunch }> = [];
    const loadUi = async () => ({
      runChat: async (launch: UiLaunch) => (launches.push({ kind: 'chat', launch }), 0),
      runWeb: async (launch: UiLaunch) => (launches.push({ kind: 'web', launch }), 0),
    });
    const tty = { stdin: {} as NodeJS.ReadStream, stdout: {} as NodeJS.WriteStream };
    const chat = environment(dir, ['embed', '-y'], { interactive: true, loadUi, tty });
    expect(await main(chat.cli)).toBe(EXIT_OK);
    const web = environment(dir, ['embed', '--ui', '--no-open', 'the in-app agent'], { loadUi, tty });
    expect(await main(web.cli)).toBe(EXIT_OK);

    expect(launches.map(({ kind }) => kind)).toEqual(['chat', 'web']);
    const [first, second] = launches.map(({ launch }) => launch);
    expect(first).toMatchObject({ cwd: dir, approveAll: true, firstPrompt: embedRequest(undefined) });
    expect(first.transformPrompt?.(embedRequest(undefined))).toContain('## Recipe: Vite overlay');
    expect(first.transformPrompt?.('now add a test')).toBe('now add a test');
    expect(second).toMatchObject({ open: false, firstPrompt: embedRequest('the in-app agent') });
    expect(second.transformPrompt?.(embedRequest('the in-app agent'))).toContain('The user asked: the in-app agent');
  });

  it('reports an unknown agent', async () => {
    const { cli, err } = environment(project({}), ['embed', '-a', 'zeta'], { agents: [] });
    expect(await main(cli)).toBe(EXIT_USAGE);
    expect(err()).toContain('Unknown agent "zeta"');
  });
});
