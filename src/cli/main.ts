import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { detectAgents } from '../agents/discovery.js';
import type { AgentBudget, AgentEvent, AgentResult, AgentTask, CodingAgent, McpServer } from '../agents/types.js';
import { withFallback } from '../agents/failover.js';
import { runWithVerify, type VerifyReport } from '../agents/verify.js';
import { defaultAgents } from '../agents/defaults.js';
import { ago } from '../ui/sessions.js';
import { cursorCloud } from '../agents/drivers/cursor-cloud.js';
import {
  agentSessionSources,
  findSession,
  groupSessions,
  listSessions,
  readSession,
} from '../agents/sessions/index.js';
import { HANDOFF_DIR, handoffPreamble, writeHandoff } from '../agents/handoff.js';
import { serveAcp } from '../acp/server.js';
import { parseCli, UsageError, type CliCommand } from './args.js';
import { embedPrompt, embedRequest, readEmbedInstructions } from './embed.js';
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
  /** The protocol input of `acp`. Default: `process.stdin`. */
  input?: NodeJS.ReadableStream;
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
  /** `--from`: the session to take over before the first prompt. */
  continueFrom?: string;
  approveAll?: boolean;
  /** `--no-artifacts`: false. */
  artifacts?: boolean;
  env: NodeJS.ProcessEnv;
  version: string;
  stdout: NodeJS.WriteStream;
  stderr: Output;
  stdin: NodeJS.ReadStream;
  signal?: AbortSignal;
  port?: number;
  open?: boolean;
  /** Sent as soon as the chat opens (`genaicode embed`). */
  firstPrompt?: string;
  /** Rewrites each prompt before it reaches the agent; the transcript shows what was typed. */
  transformPrompt?(prompt: string): string;
  /** `chat --web`: also open the session in the browser. */
  openWeb?: boolean;
  /** `ui --exit-with-stdin`: stop when stdin ends. */
  exitWithStdin?: boolean;
  /** `--mcp`: attached to every prompt. */
  task?: { mcpServers?: readonly McpServer[] };
  /** `--max-tokens`, `--max-cost`: caps on the whole session. */
  budget?: AgentBudget;
  /** `--fallback`: agents a turn moves to when the current one is out. */
  fallback?: readonly string[];
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
  genaicode sessions [options]         List the sessions agents keep on this machine, by project
  genaicode run [options] <prompt...>  Run one task (reads the prompt from stdin if omitted)
  genaicode embed [options] [request]  Have an agent add genaicode to the project here
  genaicode acp [options]              Serve the Agent Client Protocol on stdin/stdout

Sessions options:
  -a, --agent <name>      Only this agent's sessions
      --cloud             Also Cursor Cloud Agents (needs CURSOR_API_KEY)
  -C, --cwd <dir>         Only sessions in this directory or below it
      --since <age>       Only sessions active in the last 90m, 12h, 7d, 2w...
  -n, --limit <n>         At most this many sessions, newest first (default 30)
      --json              One JSON object per session

  Each line ends with the session id: continue it with
  "genaicode chat -a <agent> -C <dir> -r <id>".

Chat and UI options:
  -a, --agent <name>      Agent to start with (default: the first installed one)
  -C, --cwd <dir>         Directory the agent works in (default: current directory)
  -m, --model <id>        Model id passed to the agent CLI
      --effort <level>    Reasoning effort, in the agent's own vocabulary
  -r, --resume <id>       Continue this agent session
      --from <id>         Take over a session of any agent in this directory (ids: "genaicode
                          sessions"): its own agent resumes it, another one gets a handoff
  -y, --yes               Approve every permission request the agent asks for
      --web               (chat) Also open the session in the browser
      --port <n>          Port for the browser UI, on 127.0.0.1 (default: a free port)
      --no-open           (ui) Print the link instead of opening a browser
      --exit-with-stdin   (ui) Stop when stdin closes, for apps that start the server
      --mcp <name=url>    Give the agent this MCP server (streamable HTTP); repeatable.
                          Only agents with MCP support (claude, codex, copilot, antigravity) take it
      --no-artifacts      Do not give the agent the publish_artifact tool (pages, images and
                          documents it shows in the chat)
      --max-tokens <n>    Token budget for the whole session; prompts stop starting once it is used
      --max-cost <usd>    Cost budget for the whole session, for agents that report cost
      --fallback <agents> Agents to switch to when the current one runs out (quota, sign-in,
                          missing CLI, crash), e.g. --fallback codex,gemini. /fallback changes it

  Each prompt after the first continues the agent's session (claude, codex, cursor,
  opencode, copilot, antigravity). Prompts sent while the agent works wait in a queue. Type /help in
  the chat for commands. The terminal and the browser can show one session: /web in the
  chat opens it in the browser, and Enter in "genaicode ui" brings it into the terminal.

Run options:
  -a, --agent <name>      Agent to use (default: the first installed one, see "agents")
  -C, --cwd <dir>         Directory the agent works in (default: current directory)
  -m, --model <id>        Model id passed to the agent CLI
      --effort <level>    Reasoning effort, in the agent's own vocabulary
      --max-turns <n>     Turn limit, where the agent supports one
  -r, --resume <id>       Continue the agent session with this id (printed after each run)
      --from <id>         Continue a session of another agent: the agent gets a recap of it and
                          the transcript to read (ids: "genaicode sessions")
      --timeout <sec>     Stop the agent after this many seconds
      --verify <command>  Shell command that checks the work; on failure its output goes
                          back to the agent for another attempt
      --max-repairs <n>   Repair attempts after a failed check (default 2)
      --max-tokens <n>    Stop the agent past this many tokens (repairs included)
      --max-cost <usd>    Stop the agent past this cost in US dollars, for agents that report cost
      --fallback <agents> Agents to run the task on when the agent runs out (quota, sign-in,
                          missing CLI, crash), in order, e.g. --fallback codex,gemini
      --json              Print agent events as JSON lines instead of text

Embed options:
      --print             Print the agent's instructions instead of starting one
      --ui                Follow the agent in the browser instead of this terminal
  -a, -C, -m, --effort, -y, --port, --no-open: as for chat and ui

  The agent reads the project and chooses how to wire genaicode in; [request] steers it,
  e.g. "only the dev panel". Without a terminal it runs headless like "run". The
  instructions also ship as a Claude Code skill: docs/skills/genaicode-embed/SKILL.md.

ACP options:
  -a, -m, --effort, -y: as for chat (the host can change agent, effort and approvals)

  For editors and other apps that speak ACP (https://agentclientprotocol.com): the app
  starts "genaicode acp", opens sessions in its own directories and sends prompts.

The agent uses its own login, billing, and permission defaults. GenAIcode adds no agent
loop or sandbox of its own, and no prompts but embed's instructions.
Library API: https://github.com/gtanczyk/genaicode#readme

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
    command = { kind: 'chat', approveAll: false, open: false, web: false, mcpServers: [] };
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
    case 'sessions':
      return showSessions(cli, agents, command);
    case 'run':
      return runTask(cli, agents, command);
    case 'chat':
    case 'ui':
      return runUi(cli, agents, command);
    case 'embed':
      return runEmbed(cli, agents, command);
    case 'acp':
      return runAcp(cli, agents, command);
  }
}

async function runAcp(
  cli: CliEnvironment,
  agents: readonly CodingAgent[],
  options: Extract<CliCommand, { kind: 'acp' }>,
): Promise<number> {
  if (options.agent && !agents.some((agent) => agent.name === options.agent)) {
    cli.stderr.write(`Unknown agent "${options.agent}". Known agents: ${agents.map((a) => a.name).join(', ')}.\n`);
    return EXIT_USAGE;
  }
  const input = cli.input ?? process.stdin;
  await serveAcp({
    agents,
    agent: options.agent,
    model: options.model,
    effort: options.effort,
    approveAll: options.approveAll,
    env: cli.env,
    version: packageVersion(),
    input,
    output: cli.stdout,
    // Ctrl-C ends the connection like the host closing it: running prompts stop.
    signal: cli.signal,
  });
  return EXIT_OK;
}

async function runEmbed(
  cli: CliEnvironment,
  agents: readonly CodingAgent[],
  options: Extract<CliCommand, { kind: 'embed' }>,
): Promise<number> {
  const cwd = resolve(cli.cwd, options.cwd ?? '.');
  const prompt = embedPrompt(readEmbedInstructions(), { cwd, version: packageVersion(), request: options.request });
  if (options.print) {
    cli.stdout.write(`${prompt}\n`);
    return EXIT_OK;
  }

  const tty = cli.tty ?? { stdin: process.stdin, stdout: process.stdout };
  if (options.ui || (cli.interactive ?? (tty.stdin.isTTY && tty.stdout.isTTY))) {
    // The chat shows the short request; the agent gets the instructions.
    const request = embedRequest(options.request);
    return runUi(
      cli,
      agents,
      { ...options, kind: options.ui ? 'ui' : 'chat', cwd, web: false, mcpServers: [] },
      { firstPrompt: request, transformPrompt: (text) => (text === request ? prompt : text) },
    );
  }
  return runTask(
    cli,
    agents,
    {
      kind: 'run',
      prompt,
      agent: options.agent,
      cwd,
      model: options.model,
      effort: options.effort,
      maxRepairs: 0,
      json: false,
    },
    // -y without a terminal: the same answer the chat's auto-approve gives.
    options.approveAll ? { onApproval: async () => 'approve' as const } : {},
  );
}

async function runUi(
  cli: CliEnvironment,
  agents: readonly CodingAgent[],
  options: Extract<CliCommand, { kind: 'chat' | 'ui' }>,
  extra: Pick<UiLaunch, 'firstPrompt' | 'transformPrompt'> = {},
): Promise<number> {
  const tty = cli.tty ?? { stdin: process.stdin, stdout: process.stdout };
  if (options.kind === 'chat' && !(cli.interactive ?? (tty.stdin.isTTY && tty.stdout.isTTY))) {
    cli.stderr.write('genaicode chat needs a terminal. Use "genaicode run" for scripts, or "genaicode ui".\n');
    return EXIT_USAGE;
  }
  if (options.mcpServers.length) {
    // Only agents that take MCP servers can use them; offer just those.
    const chosen = agents.find((agent) => agent.name === options.agent);
    if (chosen && !chosen.capabilities.mcp) {
      cli.stderr.write(`Agent "${chosen.name}" does not support MCP servers in genaicode (--mcp).\n`);
      return EXIT_USAGE;
    }
    agents = agents.filter((agent) => agent.capabilities.mcp);
  }
  if (!knownAgents(cli, agents, options.fallback)) return EXIT_USAGE;
  const ui = await (cli.loadUi ?? loadBundledUi)();
  const launch: UiLaunch = {
    agents,
    agent: options.agent,
    cwd: resolve(cli.cwd, options.cwd ?? '.'),
    model: options.model,
    effort: options.effort,
    resume: options.resume,
    ...(options.from ? { continueFrom: options.from } : {}),
    approveAll: options.approveAll,
    env: cli.env,
    version: packageVersion(),
    stdout: tty.stdout,
    stderr: cli.stderr,
    stdin: tty.stdin,
    signal: cli.signal,
    port: options.port,
    open: options.open,
    openWeb: options.web,
    exitWithStdin: options.exitWithStdin,
    ...(options.mcpServers.length ? { task: { mcpServers: options.mcpServers } } : {}),
    ...(options.artifacts === false ? { artifacts: false } : {}),
    ...(options.budget ? { budget: options.budget } : {}),
    ...(options.fallback ? { fallback: options.fallback } : {}),
    ...extra,
  };
  return options.kind === 'chat' ? ui.runChat(launch) : ui.runWeb(launch);
}

/** The front ends are bundled into dist/ui by scripts/build-ui.mjs; the path is kept opaque to tsc. */
function loadBundledUi(): Promise<UiModule> {
  const bundle: string = new URL('../ui/index.js', import.meta.url).href;
  return import(bundle) as Promise<UiModule>;
}

const STATE_MARK: Record<string, string> = { active: '●', waiting: '○', unfinished: '◌' };

async function showSessions(
  cli: CliEnvironment,
  agents: readonly CodingAgent[],
  command: Extract<CliCommand, { kind: 'sessions' }>,
): Promise<number> {
  // `--cloud` adds the vendor clouds the environment has a key for.
  const cloud: CodingAgent[] = [];
  if (command.cloud) {
    const key = cli.env.CURSOR_API_KEY;
    if (key) cloud.push(cursorCloud({ apiKey: key }));
    else cli.stderr.write('--cloud: no CURSOR_API_KEY in the environment, so no cloud is listed.\n');
  }
  const sources = agentSessionSources(
    [...agents, ...cloud].filter((agent) => command.agent === undefined || agent.name === command.agent),
  );
  if (!sources.length) {
    cli.stderr.write(`No session store for agent "${command.agent}".\n`);
    return EXIT_USAGE;
  }
  const now = Date.now();
  const { sessions, errors } = await listSessions(sources, {
    limit: command.limit,
    env: cli.env,
    ...(command.cwd !== undefined ? { cwd: resolve(cli.cwd, command.cwd) } : {}),
    ...(command.sinceMs !== undefined ? { since: now - command.sinceMs } : {}),
    ...(cli.signal ? { signal: cli.signal } : {}),
  });
  for (const error of errors) cli.stderr.write(`${error.source}: ${error.message}\n`);
  if (command.json) {
    for (const session of sessions) cli.stdout.write(`${JSON.stringify(session)}\n`);
    return EXIT_OK;
  }
  if (!sessions.length) {
    cli.stdout.write('No sessions found.\n');
    return EXIT_OK;
  }
  for (const project of groupSessions(sessions)) {
    const counts = Object.entries(project.agents)
      .map(([agent, count]) => `${agent} ${count}`)
      .join(', ');
    cli.stdout.write(`\n${project.name}  ${project.key}  (${counts})\n`);
    for (const session of project.sessions) {
      const label = session.title ?? session.lastPrompt ?? session.lastReply ?? '(no prompt)';
      const text = label.length > 70 ? `${label.slice(0, 69)}…` : label;
      cli.stdout.write(
        `  ${STATE_MARK[session.state ?? ''] ?? ' '} ${session.agent.padEnd(7)} ${ago(now - session.updatedAt).padStart(4)}  ${(session.state ?? '').padEnd(10)}  ${text}  ${session.id}\n`,
      );
    }
  }
  cli.stdout.write('\n● active  ○ waiting for you  ◌ unfinished\n');
  return EXIT_OK;
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

/** `run --from`: what goes before the prompt so the agent continues another agent's session. */
async function handoffFrom(
  agents: readonly CodingAgent[],
  id: string,
  agent: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const sources = agentSessionSources(agents);
  const found = await findSession(sources, id, { env });
  if (!found) throw new Error(`No session "${id}" found. "genaicode sessions" lists them.`);
  const turns = await readSession(sources, found.session);
  if (!turns.length) throw new Error(`Nothing to read in that ${found.session.agent} session.`);
  let file: string | undefined;
  try {
    file = writeHandoff(cwd, HANDOFF_DIR, agent, turns);
  } catch {
    // An unwritable directory still gets the recap.
  }
  return handoffPreamble(turns, file);
}

async function runTask(
  cli: CliEnvironment,
  agents: readonly CodingAgent[],
  options: Extract<CliCommand, { kind: 'run' }>,
  extra: Pick<AgentTask, 'onApproval'> = {},
): Promise<number> {
  const prompt = options.prompt ?? (await cli.readStdin())?.trim();
  if (!prompt) {
    cli.stderr.write(`No prompt. Pass it as arguments or on stdin.\n\n${helpText}`);
    return EXIT_USAGE;
  }

  const picked = pickAgent(cli, agents, options.agent);
  if (!picked || !knownAgents(cli, agents, options.fallback)) return EXIT_USAGE;
  const agent = options.fallback?.length
    ? withFallback([
        picked,
        ...options.fallback.flatMap((name) => agents.filter((one) => one.name === name && one !== picked)),
      ])
    : picked;

  const cwd = resolve(cli.cwd, options.cwd ?? '.');
  let handoff = '';
  if (options.from) {
    try {
      handoff = await handoffFrom(agents, options.from, picked.name, cwd, cli.env);
    } catch (error) {
      cli.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return EXIT_USAGE;
    }
  }
  const task: AgentTask = {
    prompt: handoff + prompt,
    cwd,
    model: options.model,
    effort: options.effort,
    maxTurns: options.maxTurns,
    resume: options.resume,
    timeoutMs: options.timeoutMs,
    env: cli.env,
    signal: cli.signal,
    ...(options.budget ? { budget: options.budget } : {}),
    ...extra,
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

/** Whether every `--fallback` name is a known agent; reports the first one that is not. */
function knownAgents(
  cli: CliEnvironment,
  agents: readonly CodingAgent[],
  names: readonly string[] | undefined,
): boolean {
  const unknown = names?.find((name) => !agents.some((agent) => agent.name === name));
  if (unknown === undefined) return true;
  cli.stderr.write(
    `Unknown agent "${unknown}" in --fallback. Known agents: ${agents.map((a) => a.name).join(', ')}.\n`,
  );
  return false;
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
