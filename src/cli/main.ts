import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { detectAgents } from '../agents/discovery.js';
import type { AgentBudget, AgentEvent, AgentResult, AgentTask, CodingAgent, McpServer } from '../agents/types.js';
import { withFallback } from '../agents/failover.js';
import { runWithVerify, type VerifyReport } from '../agents/verify.js';
import { defaultAgents } from '../agents/defaults.js';
import { ago, resumeCommand } from '../ui/sessions.js';
import { cursorCloud } from '../agents/drivers/cursor-cloud.js';
import {
  agentSessionSources,
  checkSessions,
  cliVersion,
  findSession,
  groupSessions,
  waitingSessions,
  HOOK_AGENTS,
  hooksFile,
  hooksStatus,
  installHooks,
  liveDir,
  readLive,
  uninstallHooks,
  listSessions,
  readSession,
} from '../agents/sessions/index.js';
import { serveMcpStdio, SESSION_TOOLS_INSTRUCTIONS, sessionTools } from '../agents/sessions/tools.js';
import { startLocalMcpServer } from '../agents/mcp-server.js';
import {
  notifyFile,
  readNotify,
  sendNotice,
  writeNotify,
  type Notice,
  type NotifySettings,
} from '../agents/sessions/notify.js';
import { HANDOFF_DIR, handoffPreamble, writeHandoff } from '../agents/handoff.js';
import { isWithin, oneLine } from '../agents/sessions/files.js';
import type { SessionInfo, SessionSource } from '../agents/sessions/types.js';
import { serveAcp } from '../acp/server.js';
import { parseCli, UsageError, type CliCommand } from './args.js';
import { embedPrompt, embedRequest, readEmbedInstructions } from './embed.js';
import { createRenderer, describeResult, type Output } from './render.js';
import {
  autoUpdate,
  backgroundUpdate,
  defaultUpdateDeps,
  findInstall,
  INSTALL_SCRIPT_URL,
  registerRun,
  selfInstall,
  setAutoUpdate,
  stableCliPath,
  updateInstall,
  type UpdateDeps,
} from './update.js';

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
  /** What `update` and the daily check use. Defaults to the npm registry and this package. */
  updater?: Partial<UpdateDeps>;
  /** Shows a desktop notification (`notify test`). Default: `sendNotice()`. */
  notify?(notice: Notice): boolean;
  /** Runs the `--verify` command. Defaults to a shell in the task directory. */
  runCheck?(command: string, cwd: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<CheckResult>;
}

/** Options the bundled front ends take (see src/ui/index.tsx). */
export interface UiLaunch {
  agents: readonly CodingAgent[];
  sessionSources?: readonly SessionSource[];
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
  genaicode sessions doctor            Check that the agents' session stores still read as expected
  genaicode sessions mcp               Serve the session index to an agent as MCP tools (stdio)
  genaicode hooks [install|uninstall]  Have agents report what their sessions do (default: status)
  genaicode notify [on|off|test]      Desktop notification when a session asks for approval
  genaicode run [options] <prompt...>  Run one task (reads the prompt from stdin if omitted)
  genaicode embed [options] [request]  Have an agent add genaicode to the project here
  genaicode acp [options]              Serve the Agent Client Protocol on stdin/stdout
  genaicode update [options]           Update the installed genaicode command

Update options (for the command scripts/install.sh installs; npx and npm -g update through npm):
      --check             Only say whether a newer version is out
      --version <v>       Install this version instead of the latest
      --auto on|off       Check daily and update in the background (default: on)

Sessions options:
  -a, --agent <name>      Only this agent's sessions
      --cloud             Also Cursor Cloud Agents (needs CURSOR_API_KEY)
  -w, --waiting           Only sessions waiting for you (approvals first), each with the
                          command that continues it; the last 7 days unless --since says
  -C, --cwd <dir>         Only sessions in this directory or below it
      --since <age>       Only sessions active in the last 90m, 12h, 7d, 2w...
  -n, --limit <n>         At most this many sessions, newest first (default 30)
      --json              One JSON object per session

  Each line ends with the session id: continue it with
  "genaicode chat -a <agent> -C <dir> -r <id>".

  "sessions doctor" (-a, --since, --json, --api) checks each store: how many sessions it lists, how
  many have a prompt and a directory, whether the newest conversations open, and whether the
  agent's CLI is newer than the one the reader was checked with. It prints counts, never what
  was said, and exits 1 when a store reads differently than expected. With --api it also asks
  the agents that can be asked (Codex's app server) and compares; that starts the agent's own
  process, which keeps its state and logs in its home.

  "sessions mcp" (-a) is an MCP server on stdio with the tools sessions_projects, sessions_list and
  sessions_read, so any agent can answer what is open and what waits for you across all of them:
  "claude mcp add sessions -- npx genaicode sessions mcp". The agent you give it to reads what
  the other agents' sessions said. "genaicode chat --sessions" gives the same tools to the chat.

Hooks options:
  -a, --agent <name>      Only this agent (claude, codex); default: both

  "hooks install" adds a hook to the agent's own user settings (~/.claude/settings.json,
  ~/.codex/hooks.json; Codex asks you to trust it under /hooks). The agent then tells genaicode
  when a session works, asks for approval or has finished its turn, so "sessions" and the
  browser's Sessions view show which ones need you. "hooks uninstall" takes it out again.

Notify options:
      --done              With "on": also when a session finishes its turn

  "notify on" has the hooks show a desktop notification (macOS Notification Center, notify-send
  on Linux) when a session asks for approval: the agent, the project's directory name and the
  tool, nothing of what was said. It needs "genaicode hooks install". "notify test" shows one now.

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
      --sessions          Give the agent the session index as tools (sessions_projects,
                          sessions_list, sessions_read): ask it what is open or waits for you
                          in every agent. It reads what those sessions said
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

  const updater: UpdateDeps = { ...defaultUpdateDeps(cli.env), ...cli.updater };
  const quick = ['help', 'version', 'update', 'self-install'].includes(command.kind);
  // Machine-readable output and protocol servers get no banner and start no updater.
  const machine = command.kind === 'acp' || command.kind === 'sessions-mcp' || ('json' in command && command.json);
  if (!quick && !machine) autoUpdate(updater, (line) => cli.stderr.write(`${line}\n`));
  const unregister = quick ? () => {} : registerRun(updater.packageRoot);
  try {
    return await dispatch(cli, command, agents, updater);
  } finally {
    unregister();
  }
}

function dispatch(
  cli: CliEnvironment,
  command: CliCommand,
  agents: readonly CodingAgent[],
  updater: UpdateDeps,
): Promise<number> | number {
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
    case 'doctor':
      return checkStores(cli, agents, command);
    case 'sessions-mcp':
      return serveSessions(cli, agents, command);
    case 'hooks':
      return manageHooks(cli, command, updater);
    case 'notify':
      return manageNotify(cli, command);
    case 'run':
      return runTask(cli, agents, command);
    case 'chat':
    case 'ui':
      return runUi(cli, agents, command);
    case 'embed':
      return runEmbed(cli, agents, command);
    case 'acp':
      return runAcp(cli, agents, command);
    case 'update':
      return runUpdate(cli, updater, command);
    case 'self-install':
      return runSelfInstall(cli, updater, command);
  }
}

async function runUpdate(
  cli: CliEnvironment,
  deps: UpdateDeps,
  options: Extract<CliCommand, { kind: 'update' }>,
): Promise<number> {
  if (options.background) {
    await backgroundUpdate(deps);
    return EXIT_OK;
  }
  const install = findInstall(deps.packageRoot);
  if (!install) {
    cli.stderr.write(
      `This genaicode runs from ${deps.packageRoot}, not from the installed command.\n` +
        'Update it with npm ("npm install -g genaicode@latest", or bump it in your project), ' +
        `or install the command, which updates itself:\n  curl -fsSL ${INSTALL_SCRIPT_URL} | sh\n`,
    );
    return EXIT_FAILED;
  }
  if (options.auto !== undefined) {
    setAutoUpdate(install, options.auto);
    cli.stdout.write(`Automatic updates ${options.auto ? 'on' : 'off'}.\n`);
    return EXIT_OK;
  }
  try {
    const outcome = await updateInstall(install, deps, { tag: options.version, check: options.check });
    switch (outcome.kind) {
      case 'current':
        cli.stdout.write(`genaicode ${outcome.version} is up to date.\n`);
        return EXIT_OK;
      case 'available':
        cli.stdout.write(`genaicode ${outcome.to} is out (installed: ${outcome.from}). Run "genaicode update".\n`);
        return EXIT_OK;
      case 'busy':
        cli.stderr.write('Another genaicode update is running; try again in a minute.\n');
        return EXIT_FAILED;
      case 'updated':
        cli.stdout.write(`Updated genaicode ${outcome.from} → ${outcome.to}.\n`);
        if (outcome.notes) {
          const lines = outcome.notes.split('\n');
          const shown = lines.length > 40 ? [...lines.slice(0, 40), '...'] : lines;
          cli.stdout.write(`\n${shown.join('\n')}\n`);
          if (lines.length > 40) {
            cli.stdout.write('All changes: https://github.com/gtanczyk/genaicode/blob/master/docs/CHANGELOG.md\n');
          }
        }
        return EXIT_OK;
    }
  } catch (error) {
    cli.stderr.write(`Update failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_FAILED;
  }
}

function runSelfInstall(
  cli: CliEnvironment,
  deps: UpdateDeps,
  options: Extract<CliCommand, { kind: 'self-install' }>,
): number {
  try {
    const result = selfInstall({
      packageRoot: deps.packageRoot,
      binDir: options.binDir,
      force: options.force,
      env: cli.env,
    });
    cli.stdout.write(`Installed genaicode ${result.version}: ${result.shim}\n`);
    if (!result.onPath) {
      const dir = dirname(result.shim);
      cli.stdout.write(
        `${dir} is not on your PATH. Add it to your shell profile (~/.zshrc, ~/.bashrc):\n` +
          `  export PATH="${dir}:$PATH"\n`,
      );
    }
    return EXIT_OK;
  } catch (error) {
    cli.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_FAILED;
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
  // Sessions are read from every agent's store, not only from the agents this chat can run.
  const indexed = agentSessionSources(agents);
  if (options.sessions && options.mcpServers.some((server) => server.name === 'sessions')) {
    cli.stderr.write('--sessions adds an MCP server named "sessions": give the --mcp one another name.\n');
    return EXIT_USAGE;
  }
  if (options.mcpServers.length || options.sessions) {
    // Only agents that take MCP servers can use them; offer just those.
    const chosen = agents.find((agent) => agent.name === options.agent);
    if (chosen && !chosen.capabilities.mcp) {
      const flag = options.mcpServers.length ? '--mcp' : '--sessions';
      cli.stderr.write(`Agent "${chosen.name}" does not support MCP servers in genaicode (${flag}).\n`);
      return EXIT_USAGE;
    }
    agents = agents.filter((agent) => agent.capabilities.mcp);
  }
  if (!knownAgents(cli, agents, options.fallback)) return EXIT_USAGE;
  const ui = await (cli.loadUi ?? loadBundledUi)();
  // `--sessions`: the index of every agent's sessions, as tools of the agent in this chat.
  const index = options.sessions
    ? await startLocalMcpServer({
        name: 'sessions',
        tools: sessionTools(indexed, { env: cli.env }),
        instructions: SESSION_TOOLS_INSTRUCTIONS,
      })
    : undefined;
  const mcpServers = [...options.mcpServers, ...(index ? [index.mcpServer] : [])];
  const launch: UiLaunch = {
    agents,
    sessionSources: indexed,
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
    ...(mcpServers.length ? { task: { mcpServers } } : {}),
    ...(options.artifacts === false ? { artifacts: false } : {}),
    ...(options.budget ? { budget: options.budget } : {}),
    ...(options.fallback ? { fallback: options.fallback } : {}),
    ...extra,
  };
  try {
    return await (options.kind === 'chat' ? ui.runChat(launch) : ui.runWeb(launch));
  } finally {
    await index?.close();
  }
}

/** `sessions mcp`: the session index as MCP tools on stdio, for an agent's own MCP configuration. */
async function serveSessions(
  cli: CliEnvironment,
  agents: readonly CodingAgent[],
  command: Extract<CliCommand, { kind: 'sessions-mcp' }>,
): Promise<number> {
  const sources = agentSessionSources(
    agents.filter((agent) => command.agent === undefined || agent.name === command.agent),
  );
  if (!sources.length) {
    cli.stderr.write(`No session store for agent "${command.agent}".\n`);
    return EXIT_USAGE;
  }
  // A host that left closes the pipe: that ends the serving, it is not an error to report.
  const pipe = cli.stdout as Partial<Pick<NodeJS.WritableStream, 'on' | 'off'>>;
  const gone = () => undefined;
  pipe.on?.('error', gone);
  await serveMcpStdio(sessionTools(sources, { env: cli.env }), {
    input: cli.input ?? process.stdin,
    output: cli.stdout,
    ...(cli.signal ? { signal: cli.signal } : {}),
  });
  pipe.off?.('error', gone);
  return EXIT_OK;
}

/** The front ends are bundled into dist/ui by scripts/build-ui.mjs; the path is kept opaque to tsc. */
function loadBundledUi(): Promise<UiModule> {
  const bundle: string = new URL('../ui/index.js', import.meta.url).href;
  return import(bundle) as Promise<UiModule>;
}

const STATE_MARK: Record<string, string> = { active: '●', waiting: '○', unfinished: '◌', approval: '◆' };
const WAITING_SINCE_MS = 7 * 24 * 60 * 60 * 1000;

/** `sessions --waiting`: one line per session that waits for you, approvals first, with the command that continues it. */
function showWaiting(cli: CliEnvironment, sessions: readonly SessionInfo[], now: number, sinceMs?: number): number {
  const period = sinceMs === undefined ? '' : ` in the last ${ago(sinceMs)}`;
  if (!sessions.length) {
    cli.stdout.write(`Nothing waits for you${period}.\n`);
    return EXIT_OK;
  }
  const asks = sessions.filter((session) => session.waitingFor === 'approval').length;
  cli.stdout.write(
    `${sessions.length} session${sessions.length === 1 ? '' : 's'} wait${sessions.length === 1 ? 's' : ''} for you${period}${asks ? `, ${asks} for approval` : ''}:\n`,
  );
  for (const session of sessions) {
    const place = session.cwd ?? session.repository ?? '';
    const project = place.split(/[\\/]/).filter(Boolean).pop() ?? place;
    const label = session.title ?? session.lastPrompt ?? session.firstPrompt ?? '(no prompt)';
    const text = label.length > 60 ? `${label.slice(0, 59)}…` : label;
    const what =
      session.waitingFor === 'approval'
        ? `asks to use ${session.waitingTool ?? 'a tool'}`
        : session.lastReply
          ? `said: ${oneLine(session.lastReply, 80)}`
          : 'your turn';
    const resume = resumeCommand(session);
    cli.stdout.write(
      `\n${session.waitingFor === 'approval' ? '◆' : '○'} ${project || '(no directory)'}  ${session.agent}  ${ago(now - session.updatedAt)} ago\n  ${text}\n  ${what}\n${resume ? `  ${resume}\n` : ''}`,
    );
  }
  return EXIT_OK;
}

async function manageNotify(cli: CliEnvironment, command: Extract<CliCommand, { kind: 'notify' }>): Promise<number> {
  const describe = (settings: NotifySettings) =>
    settings.approval ? `on: when a session asks for approval${settings.done ? ' or finishes its turn' : ''}` : 'off';
  if (command.action === 'test') {
    const shown = (cli.notify ?? sendNotice)({ title: 'genaicode', body: 'Notifications work.' });
    if (!shown) {
      cli.stderr.write(`No desktop notifications on ${process.platform} yet (macOS and Linux only).\n`);
      return EXIT_FAILED;
    }
    cli.stdout.write('Sent a test notification.\n');
    return EXIT_OK;
  }
  if (command.action !== 'status') {
    await writeNotify({ approval: command.action === 'on', done: command.action === 'on' && command.done }, cli.env);
  }
  const settings = await readNotify(cli.env);
  cli.stdout.write(`Notifications ${describe(settings)}  ${notifyFile(cli.env)}\n`);
  if (settings.approval) {
    const statuses = await Promise.all(
      HOOK_AGENTS.map((agent) => hooksStatus(agent, { env: cli.env }).catch(() => undefined)),
    );
    if (!statuses.some((status) => status?.events.length)) {
      cli.stdout.write('No agent reports to genaicode yet: run "genaicode hooks install" for the notifications.\n');
    }
  }
  return EXIT_OK;
}

async function manageHooks(
  cli: CliEnvironment,
  command: Extract<CliCommand, { kind: 'hooks' }>,
  updater: UpdateDeps,
): Promise<number> {
  const known: readonly string[] = HOOK_AGENTS;
  if (command.agent !== undefined && !known.includes(command.agent)) {
    cli.stderr.write(`No hooks for agent "${command.agent}". Agents with hooks: ${known.join(', ')}.\n`);
    return EXIT_USAGE;
  }
  // The installed command's hooks run `current`, which survives updates; otherwise this package.
  const install = findInstall(updater.packageRoot);
  const hookOptions = {
    env: cli.env,
    ...(install ? { command: `"${process.execPath}" "${stableCliPath(updater.packageRoot)}" hook` } : {}),
  };
  const chosen = HOOK_AGENTS.filter((agent) => command.agent === undefined || agent === command.agent);
  const installedHere = new Map(
    detectAgents(cli.agents ?? defaultAgents(), cli.env).map((found) => [found.agent.name, found.path]),
  );
  let failed = false;
  for (const agent of chosen) {
    try {
      if (command.action === 'install') {
        // Asked for by name, an agent gets its hooks even when its CLI is not found.
        if (command.agent === undefined && !installedHere.get(agent)) {
          cli.stdout.write(`${agent}: not installed, skipped\n`);
          continue;
        }
        const status = await installHooks(agent, hookOptions);
        cli.stdout.write(`${agent}: hook added to ${status.file} (${status.events.join(', ')})\n`);
        if (agent === 'codex') cli.stdout.write('  Codex runs it once you trust it: open Codex and use /hooks.\n');
      } else if (command.action === 'uninstall') {
        const removed = await uninstallHooks(agent, hookOptions);
        cli.stdout.write(
          `${agent}: ${removed ? `hook removed from ${hooksFile(agent, cli.env)}` : 'no hook installed'}\n`,
        );
      } else {
        const status = await hooksStatus(agent, hookOptions);
        const state = status.installed
          ? 'installed'
          : status.events.length
            ? 'installed by another genaicode or incomplete: run "genaicode hooks install"'
            : 'not installed';
        cli.stdout.write(`${agent}: ${state}  ${status.file}\n`);
      }
    } catch (error) {
      failed = true;
      cli.stderr.write(`${agent}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  if (command.action === 'status') {
    const live = await readLive(cli.env);
    cli.stdout.write(`${live.size} session${live.size === 1 ? '' : 's'} reported in ${liveDir(cli.env)}\n`);
  }
  return failed ? EXIT_FAILED : EXIT_OK;
}

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
  // What waits is picked from everything listed, so the limit comes after; a week back by default.
  const sinceMs = command.sinceMs ?? (command.waiting ? WAITING_SINCE_MS : undefined);
  const listing = await listSessions(sources, {
    ...(command.waiting ? {} : { limit: command.limit }),
    env: cli.env,
    ...(command.cwd !== undefined ? { cwd: resolve(cli.cwd, command.cwd) } : {}),
    ...(sinceMs !== undefined ? { since: now - sinceMs } : {}),
    ...(cli.signal ? { signal: cli.signal } : {}),
  });
  const { errors } = listing;
  const sessions = command.waiting ? waitingSessions(listing.sessions).slice(0, command.limit) : listing.sessions;
  for (const error of errors) cli.stderr.write(`${error.source}: ${error.message}\n`);
  if (command.json) {
    for (const session of sessions) cli.stdout.write(`${JSON.stringify(session)}\n`);
    return EXIT_OK;
  }
  if (command.waiting) return showWaiting(cli, sessions, now, sinceMs);
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
      // A session that asks for approval stands out from one that just finished its turn.
      const state = session.waitingFor === 'approval' ? 'approval' : (session.state ?? '');
      cli.stdout.write(
        `  ${STATE_MARK[state] ?? ' '} ${session.agent.padEnd(7)} ${ago(now - session.updatedAt).padStart(4)}  ${state.padEnd(10)}  ${text}  ${session.id}\n`,
      );
    }
  }
  cli.stdout.write('\n● active  ◆ asks for approval  ○ waiting for you  ◌ unfinished\n');
  return EXIT_OK;
}

/** `sessions doctor`: counts per store, and what looks broken. Nothing of what was said. */
async function checkStores(
  cli: CliEnvironment,
  agents: readonly CodingAgent[],
  command: Extract<CliCommand, { kind: 'doctor' }>,
): Promise<number> {
  const chosen = agents.filter((agent) => command.agent === undefined || agent.name === command.agent);
  const sources = agentSessionSources(chosen);
  if (!sources.length) {
    cli.stderr.write(`No session store for agent "${command.agent}".\n`);
    return EXIT_USAGE;
  }
  // The CLI of the first installed agent that keeps its sessions in this store.
  const paths = detectAgents(chosen, cli.env);
  const commandOf = (name: string) => paths.find((found) => found.agent.sessions?.name === name && found.path)?.path;
  const checks = await checkSessions(sources, {
    env: cli.env,
    reference: command.api,
    ...(command.sinceMs !== undefined ? { since: Date.now() - command.sinceMs } : {}),
    ...(cli.signal ? { signal: cli.signal } : {}),
    version: async (source) => {
      const path = commandOf(source.name);
      return path ? cliVersion(path, cli.env) : undefined;
    },
  });
  const failed = checks.some((check) => check.problems.length);
  if (command.json) {
    for (const check of checks) cli.stdout.write(`${JSON.stringify(check)}\n`);
    return failed ? EXIT_FAILED : EXIT_OK;
  }
  for (const check of checks) {
    const version = check.version
      ? `${check.version}${check.verified ? (check.newer ? ` (checked with ${check.verified})` : '') : ' (never checked)'}`
      : commandOf(check.source)
        ? 'version unknown'
        : 'not installed';
    const verdict = check.problems.length ? 'PROBLEM' : check.listed ? 'ok' : 'no sessions';
    cli.stdout.write(`\n${check.source}  ${version}  ${verdict}\n`);
    if (check.listed) {
      cli.stdout.write(
        `  ${check.listed} session${check.listed === 1 ? '' : 's'}: ${check.withPrompt} with a prompt or title, ${check.withCwd} with a directory, ${check.withState} with a state\n`,
      );
    }
    if (check.sampled) {
      cli.stdout.write(
        `  read ${check.read} of the ${check.sampled} newest: agent messages in ${check.withReply}, tool calls in ${check.withTools}\n`,
      );
    }
    if (check.reference) {
      cli.stdout.write(
        `  ${check.source} itself lists ${check.reference.listed}: ${check.reference.listed - check.reference.missing} of them read here\n`,
      );
    }
    if (check.hooks) {
      cli.stdout.write(
        `  hooks: ${check.hooks.installed ? `installed, ${check.hooks.reported} sessions reported` : 'not installed'}\n`,
      );
    }
    for (const problem of check.problems) cli.stdout.write(`  ! ${problem}\n`);
    for (const note of check.notes) cli.stdout.write(`  - ${note}\n`);
  }
  cli.stdout.write(
    failed
      ? '\nA store reads differently than expected: its agent may have changed how it keeps sessions.\n'
      : '\nEvery store reads as expected.\n',
  );
  return failed ? EXIT_FAILED : EXIT_OK;
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
  const theirs = found.session;
  // The agent would otherwise continue one project's conversation in another project.
  if (!theirs.cwd || !isWithin(theirs.cwd, cwd)) {
    const where = theirs.cwd ? ` It belongs to ${theirs.cwd}: run there (-C).` : '';
    throw new Error(`That ${theirs.agent} session is not from ${cwd}.${where}`);
  }
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
