import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { detectAgents } from '../agents/discovery.js';
import type { AgentEvent, AgentResult, AgentTask, CodingAgent } from '../agents/types.js';
import { runWithVerify, type VerifyReport } from '../agents/verify.js';
import { defaultAgents } from './agents.js';
import { parseCli, UsageError, type CliCommand } from './args.js';
import { createRenderer, describeResult, type Output } from './render.js';

export interface CliEnvironment {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  stdout: Output;
  stderr: Output;
  /** The prompt when none is given as arguments. Return undefined when stdin is a terminal. */
  readStdin(): Promise<string | undefined>;
  /** Stops a running task (Ctrl-C). */
  signal?: AbortSignal;
  /** Agents to offer. Defaults to every headless driver. */
  agents?: readonly CodingAgent[];
  /** Both stdin and stdout are terminals: `genaicode` with no arguments opens the chat. */
  interactive?: boolean;
  /** Terminal streams for the chat UI. */
  tty?: { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream };
  /** Loads the bundled chat and web front ends. Defaults to `dist/ui/index.js`. */
  loadUi?(): Promise<UiModule>;
  /** Runs the `--verify` command. Defaults to a shell in the task directory. */
  runCheck?(command: string, cwd: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<CheckResult>;
}

/** Options the bundled front ends take (see src/ui/index.tsx). */
export interface UiLaunch {
  agents: readonly CodingAgent[];
  agent?: string;
  cwd: string;
  model?: string;
  effort?: string;
  resume?: string;
  approveAll?: boolean;
  env: NodeJS.ProcessEnv;
  version: string;
  stdout: NodeJS.WriteStream;
  stderr: Output;
  stdin: NodeJS.ReadStream;
  signal?: AbortSignal;
  port?: number;
  open?: boolean;
}

export interface UiModule {
  runChat(options: UiLaunch): Promise<number>;
  runWeb(options: UiLaunch): Promise<number>;
}

export interface CheckResult {
  exitCode: number | null;
  output: string;
}

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_ABORTED = 130;

export const helpText = `genaicode: run the coding-agent CLIs installed on this machine behind one interface.

Usage:
  genaicode                            Chat with an agent in this terminal (same as "chat")
  genaicode chat [options]             Chat with an agent in this terminal
  genaicode ui [options]               Chat with an agent in the browser (local server)
  genaicode agents [--json]            List supported agents and whether each is installed
  genaicode run [options] <prompt...>  Run one task (reads the prompt from stdin if omitted)

Chat and UI options:
  -a, --agent <name>      Agent to start with (default: the first installed one)
  -C, --cwd <dir>         Directory the agent works in (default: current directory)
  -m, --model <id>        Model id passed to the agent CLI
      --effort <level>    Reasoning effort, in the agent's own vocabulary
  -r, --resume <id>       Continue this agent session
  -y, --yes               Approve every permission request the agent asks for
      --port <n>          (ui) Port to listen on, on 127.0.0.1 (default: a free port)
      --no-open           (ui) Print the link instead of opening a browser

  Each prompt after the first continues the agent's session (claude, codex, cursor,
  opencode, copilot). Prompts sent while the agent works wait in a queue. Type /help in
  the chat for commands.

Run options:
  -a, --agent <name>      Agent to use (default: the first installed one, see "agents")
  -C, --cwd <dir>         Directory the agent works in (default: current directory)
  -m, --model <id>        Model id passed to the agent CLI
      --effort <level>    Reasoning effort, in the agent's own vocabulary
      --max-turns <n>     Turn limit, where the agent supports one
  -r, --resume <id>       Continue the agent session with this id (printed after each run)
      --timeout <sec>     Stop the agent after this many seconds
      --verify <command>  Shell command that checks the work; on failure its output goes
                          back to the agent for another attempt
      --max-repairs <n>   Repair attempts after a failed check (default 2)
      --json              Print agent events as JSON lines instead of text

The agent uses its own login, billing, and permission defaults. GenAIcode adds no agent
loop, prompts, or sandbox of its own. Library API: https://github.com/gtanczyk/genaicode#readme

Looking for the legacy 1.x coding agent?
  Run it:  npx genaicode@1
  Source:  https://github.com/gtanczyk/genaicode/tree/1.x
`;

/** Run the CLI and return its exit code. */
export async function main(cli: CliEnvironment): Promise<number> {
  let command: CliCommand;
  try {
    command = parseCli(cli.argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    cli.stderr.write(`${error.message}\n\n${helpText}`);
    return EXIT_USAGE;
  }

  const agents = cli.agents ?? defaultAgents();
  if (command.kind === 'help' && cli.argv.length === 0 && cli.interactive) {
    command = { kind: 'chat', approveAll: false, open: false };
  }
  switch (command.kind) {
    case 'help':
      cli.stdout.write(helpText);
      return EXIT_OK;
    case 'version':
      cli.stdout.write(`${packageVersion()}\n`);
      return EXIT_OK;
    case 'agents':
      return listAgents(cli, agents, command.json);
    case 'run':
      return runTask(cli, agents, command);
    case 'chat':
    case 'ui':
      return runUi(cli, agents, command);
  }
}

async function runUi(
  cli: CliEnvironment,
  agents: readonly CodingAgent[],
  options: Extract<CliCommand, { kind: 'chat' | 'ui' }>,
): Promise<number> {
  const tty = cli.tty ?? { stdin: process.stdin, stdout: process.stdout };
  if (options.kind === 'chat' && !(cli.interactive ?? (tty.stdin.isTTY && tty.stdout.isTTY))) {
    cli.stderr.write('genaicode chat needs a terminal. Use "genaicode run" for scripts, or "genaicode ui".\n');
    return EXIT_USAGE;
  }
  const ui = await (cli.loadUi ?? loadBundledUi)();
  const launch: UiLaunch = {
    agents,
    agent: options.agent,
    cwd: resolve(cli.cwd, options.cwd ?? '.'),
    model: options.model,
    effort: options.effort,
    resume: options.resume,
    approveAll: options.approveAll,
    env: cli.env,
    version: packageVersion(),
    stdout: tty.stdout,
    stderr: cli.stderr,
    stdin: tty.stdin,
    signal: cli.signal,
    port: options.port,
    open: options.open,
  };
  return options.kind === 'chat' ? ui.runChat(launch) : ui.runWeb(launch);
}

/** The front ends are bundled into dist/ui by scripts/build-ui.mjs; the path is kept opaque to tsc. */
function loadBundledUi(): Promise<UiModule> {
  const bundle: string = new URL('../ui/index.js', import.meta.url).href;
  return import(bundle) as Promise<UiModule>;
}

function listAgents(cli: CliEnvironment, agents: readonly CodingAgent[], json: boolean): number {
  const found = detectAgents(agents, cli.env);
  if (json) {
    for (const { agent, path } of found) {
      cli.stdout.write(`${JSON.stringify({ name: agent.name, command: agent.command, path })}\n`);
    }
    return EXIT_OK;
  }
  const width = Math.max(...agents.map((agent) => agent.name.length));
  for (const { agent, path } of found) {
    cli.stdout.write(`${agent.name.padEnd(width)}  ${path ?? `not installed (${agent.command})`}\n`);
  }
  return EXIT_OK;
}

async function runTask(
  cli: CliEnvironment,
  agents: readonly CodingAgent[],
  options: Extract<CliCommand, { kind: 'run' }>,
): Promise<number> {
  const prompt = options.prompt ?? (await cli.readStdin())?.trim();
  if (!prompt) {
    cli.stderr.write(`No prompt. Pass it as arguments or on stdin.\n\n${helpText}`);
    return EXIT_USAGE;
  }

  const agent = pickAgent(cli, agents, options.agent);
  if (!agent) return EXIT_USAGE;

  const task: AgentTask = {
    prompt,
    cwd: resolve(cli.cwd, options.cwd ?? '.'),
    model: options.model,
    effort: options.effort,
    maxTurns: options.maxTurns,
    resume: options.resume,
    timeoutMs: options.timeoutMs,
    env: cli.env,
    signal: cli.signal,
  };
  const render = options.json
    ? (event: AgentEvent) => cli.stdout.write(`${JSON.stringify(event)}\n`)
    : createRenderer(cli.stdout, cli.stderr);
  const note = (line: string) => {
    if (!options.json) cli.stderr.write(`${line}\n`);
  };

  note(`${agent.name} in ${task.cwd}`);
  if (!options.verify) {
    const run = agent.run(task);
    for await (const event of run) render(event);
    const result = await run.result;
    note(describeResult(agent.name, result));
    return exitCode(result);
  }

  const verify = options.verify;
  const runCheck = cli.runCheck ?? shellCheck;
  const loop = await runWithVerify(agent, task, {
    maxRepairs: options.maxRepairs,
    onEvent: (event) => {
      render(event);
      if (event.type === 'done') note(describeResult(agent.name, event.result));
    },
    async verify(attempt): Promise<VerifyReport> {
      note(`verify: ${verify}`);
      const check = await runCheck(verify, task.cwd, cli.env, cli.signal);
      const ok = check.exitCode === 0;
      if (options.json) {
        cli.stdout.write(`${JSON.stringify({ type: 'verify', attempt, ok, exitCode: check.exitCode })}\n`);
      } else {
        note(ok ? 'verify: passed' : `verify: failed (exit ${check.exitCode ?? 'signal'})`);
      }
      return { ok, detail: check.output };
    },
  });
  if (!loop.ok && loop.error) note(loop.error);
  const last = loop.attempts.at(-1)?.result;
  if (loop.ok) return EXIT_OK;
  return last?.status === 'aborted' || cli.signal?.aborted ? EXIT_ABORTED : EXIT_FAILED;
}

function pickAgent(
  cli: CliEnvironment,
  agents: readonly CodingAgent[],
  name: string | undefined,
): CodingAgent | undefined {
  if (name) {
    const agent = agents.find((candidate) => candidate.name === name);
    if (!agent) {
      cli.stderr.write(`Unknown agent "${name}". Known agents: ${agents.map((a) => a.name).join(', ')}.\n`);
    }
    return agent;
  }
  const installed = detectAgents(agents, cli.env).find(({ path }) => path);
  if (!installed) {
    cli.stderr.write(
      `No supported agent CLI found on PATH. Install one of: ${agents.map((a) => a.command).join(', ')}.\n`,
    );
  }
  return installed?.agent;
}

function exitCode(result: AgentResult): number {
  if (result.ok) return EXIT_OK;
  return result.status === 'aborted' ? EXIT_ABORTED : EXIT_FAILED;
}

/** Keep the tail of the check's output: that is where test runners put the failures. */
const CHECK_OUTPUT_LIMIT = 16_000;

function shellCheck(command: string, cwd: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<CheckResult> {
  return new Promise((done) => {
    let output = '';
    const child = spawn(command, { cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'], signal });
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-CHECK_OUTPUT_LIMIT);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => done({ exitCode: null, output: `${output}\n${error.message}`.trim() }));
    child.on('close', (code) => done({ exitCode: code, output }));
  });
}

function packageVersion(): string {
  const require = createRequire(import.meta.url);
  return (require('../../package.json') as { version: string }).version;
}
