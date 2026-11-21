import { runCheckProcess, type CheckResult } from './check-process.js';
import { worktreeCheck } from './pack-verify.js';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { detectAgents } from '../agents/discovery.js';
import type { AgentBudget, AgentEvent, AgentResult, AgentTask, CodingAgent, McpServer } from '../agents/types.js';
import { withFallback } from '../agents/failover.js';
import { runWithVerify, type VerifyReport } from '../agents/verify.js';
import { defaultAgents } from '../agents/defaults.js';
import { pack } from '../agents/pack.js';
import { codexLive } from '../agents/drivers/codex-live.js';
import { museLive } from '../agents/drivers/muse-live.js';
import { sendSession } from '../agents/sessions/send.js';
import { detachSend } from './detach-send.js';
import { ago, resumeCommand } from '../ui/sessions.js';
import { cursorCloud } from '../agents/drivers/cursor-cloud.js';
import {
  agentSessionSources,
  checkSessions,
  cliVersion,
  findSession,
  groupSessions,
  isAsking,
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
import { codexProjects } from '../agents/sessions/codex.js';
import { TowerInbox } from '../agents/sessions/tower.js';
import {
  answerAsk,
  asksForSession,
  pendingAsks,
  type AskDecision,
  type PendingAsk,
} from '../agents/sessions/answer.js';
import { ANSWER_AGENTS } from '../agents/sessions/hooks.js';
import { archiveKey, archiveSessions, readArchive, STALE_MS, staleSessions } from '../agents/sessions/archive.js';
import { startLocalMcpServer } from '../agents/mcp-server.js';
import type { McpTool } from '../agents/mcp-tools.js';
import {
  notifyFile,
  readNotify,
  sendNotice,
  writeNotify,
  type Notice,
  type NotifySettings,
} from '../agents/sessions/notify.js';
import {
  describeKnownLimits,
  knownLimits,
  recordLimits,
  shortLimit,
  statusLineLimits,
  type KnownLimit,
} from '../agents/sessions/limits.js';
import {
  findTopic,
  mergeTopics,
  moveSessions,
  folderTopics,
  projectTopics,
  readTopics,
  renameTopic,
  sortedTopics,
  summarizeTopics,
  topicNamed,
  topicsBatches,
  topicsPrompt,
  unsortedSessions,
  withTopicsRun,
  writeTopics,
  type TopicStore,
} from '../agents/sessions/topics.js';
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
  installCommand,
  shadowingCommand,
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
  /** How often `sessions --watch` looks again, in milliseconds. Default: 3 seconds. */
  watchEveryMs?: number;
  /** Shows a desktop notification (`notify test`). Default: `sendNotice()`. */
  notify?(notice: Notice): boolean;
  /** Runs the `--verify` command. Defaults to a shell in the task directory. */
  runCheck?(command: string, cwd: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<CheckResult>;
}

/** Options the bundled front ends take (see src/ui/index.tsx). */
export interface UiLaunch {
  agents: readonly CodingAgent[];
  /** Every driver available to the Sessions view, including those outside the chat's MCP filter. */
  sessionAgents?: readonly CodingAgent[];
  sessionSources?: readonly SessionSource[];
  sessionTools?: readonly McpTool[];
  towerInbox?: TowerInbox;
  waitingOnStart?: boolean;
  startupNotice?: string;
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

export type { CheckResult } from './check-process.js';

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_ABORTED = 130;

export const helpText = `genaicode: run the coding-agent CLIs installed on this machine behind one interface.

Usage:
  genaicode                            Chat with an agent in this terminal (same as "chat")
  genaicode chat [options]             Chat with an agent in this terminal
  genaicode tower [chat options]       Open the waiting queue and chat about sessions across projects
  genaicode ui [options]               Chat with an agent in the browser (local server)
  genaicode agents [--json]            List supported agents and whether each is installed
  genaicode sessions [options]         List the sessions agents keep on this machine, by project
  genaicode sessions send <id> <text>  Send a prompt to a waiting local session in its own agent
  genaicode sessions doctor            Check that the agents' session stores still read as expected
  genaicode sessions mcp               Serve the session index to an agent as MCP tools (stdio)
  genaicode sessions approve|deny <q>  Answer a question a session asks (see "hooks install --answer")
  genaicode sessions archive <id...>   Put sessions away (--stale: all left for 2 days or more)
  genaicode hooks [install|uninstall]  Have agents report what their sessions do (default: status)
  genaicode limits [--json]           How much of each agent's plan is used, as last seen
  genaicode topics [refresh]          Your sessions as pieces of work, across agents and directories
  genaicode notify [on|off|test]      Desktop notification when a session asks for approval
  genaicode run [options] <prompt...>  Run one task (reads the prompt from stdin if omitted)
  genaicode embed [options] [request]  Have an agent add genaicode to the project here
  genaicode acp [options]              Serve the Agent Client Protocol on stdin/stdout
  genaicode install [options]          Install "genaicode" as a command that updates itself
  genaicode update [options]           Update the installed genaicode command

Install options (macOS, Linux; same as scripts/install.sh):
      --version <v>       Install this version (default: the one running, e.g. via npx)
      --bin-dir <dir>     Where the command goes (default: ~/.local/bin)
      --force             Replace a "genaicode" there that the installer did not write

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
      --watch             With --waiting --json: stay open and print {"sessions":[...]} as one
                          line whenever what waits changes (--exit-with-stdin: until stdin closes)
      --archived          Also the sessions put away with "sessions archive"
      --automated         Also the sessions nobody typed into (scheduled tasks, headless runs)

  Each line ends with the session id: continue it with
  "genaicode chat -a <agent> -C <dir> -r <id>".

  "sessions send <id> <prompt>" streams the reply. It also reads the prompt from stdin.
  --detach returns when the agent starts; -a chooses the agent's store. --sandbox takes
  read-only, workspace-write or unrestricted. Without it the driver uses its own defaults.
  From a shell that a coding agent runs it refuses unless you pass --force.

  "sessions archive <id...>" hides sessions you will not come back to; "sessions archive --stale"
  (--older 5d, -a) does it for every one waiting for you or left half way for 2 days or more.
  The agents' own files stay as they are, and a session with any news comes back by itself;
  "sessions unarchive <id...>" brings one back. Kept in ~/.genaicode/archived.json.

  "sessions doctor" (-a, --since, --json, --api) checks each store: how many sessions it lists, how
  many have a prompt and a directory, whether the newest conversations open, and whether the
  agent's CLI is newer than the one the reader was checked with. It prints counts, never what
  was said, and exits 1 when a store reads differently than expected. With --api it also asks
  the agents that can be asked (Codex's app server) and compares; that starts the agent's own
  process, which keeps its state and logs in its home.

  "sessions mcp" (-a) serves sessions_projects, sessions_list, sessions_read and sessions_waiting
  on stdio. Any agent can use them to find open sessions and see which ones need your attention:
  "claude mcp add sessions -- npx genaicode sessions mcp". The agent you give it to reads what
  the other agents' sessions said. "genaicode chat --sessions" gives the same tools to the chat.
  In that chat, /waiting [project] refreshes the queue and /read <id> previews a conversation.

Topics:
  genaicode topics [--json] [--since 30d]       The topics, what asks for you first
  genaicode topics show <topic>                 The sessions of one (by id, name or part of it)
  genaicode topics refresh [--again] [-a <agent>] [-m <model>]
                                                Have an agent sort the sessions no topic has yet
  genaicode topics rename <topic> <name>
  genaicode topics merge <topic> <into>
  genaicode topics move <session id...> --to <topic or new name> | --out

  A topic is one piece of work, whichever agents and directories its sessions were in. Nothing is
  sorted until you run "topics refresh": it gives an agent one line per unsorted session (agent,
  directory, title or prompts) and keeps the answer in ~/.genaicode/topics.json. Only new sessions
  are sorted the next time, and what you renamed, merged or moved stays. Sessions relayed from a
  claude.ai project go to a topic named as that project, without asking an agent. "--again" drops
  the topics there are, your corrections too, and sorts everything anew. A topic "asks you" for
  approvals, and for 3 days after a session's last message asked something.

Hooks options:
  -a, --agent <name>      Only this agent (claude, codex, gemini, copilot, cursor); default: all installed
      --answer            With "install" (Claude Code): questions can also be answered here

  "hooks install" adds a hook to the agent's own user settings (~/.claude/settings.json,
  ~/.codex/hooks.json, ~/.gemini/settings.json, ~/.cursor/hooks.json,
  ~/.copilot/hooks/genaicode.json; Codex asks you to trust it under /hooks). The agent then tells genaicode
  when a session works, asks for approval or has finished its turn, so "sessions" and the
  browser's Sessions view show which ones need you. "hooks uninstall" takes it out again.

  "hooks install --answer" also holds each approval question of Claude Code open for up to 9
  minutes: Claude Code shows its dialog as always, and "sessions --waiting" or the browser's
  Sessions view can answer it too ("sessions approve <q>", "sessions deny <q> -m <why>").
  Whichever answer comes first counts.

Limits:
  "limits" shows how much of each agent's plan is used, in the plan's own measure: the share of
  each window (5h, 7d...) and when it resets, with the age of the reading. Nothing is asked of
  the agents for it: genaicode keeps what they report when they run through it, reads what Codex
  notes in its own sessions, and what Claude Code gives its status line. For that last one, set
  "genaicode hooks install" makes "genaicode limits record" Claude Code's status line, unless you
  have one of your own: then have yours pass its input on to that command.

Notify options:
      --done              With "on": also when a session finishes its turn

  "notify on" has the hooks show a desktop notification (macOS Notification Center, notify-send
  on Linux) when a session asks for approval: the agent, the project's directory name and the
  tool, nothing of what was said. It needs "genaicode hooks install". "notify test" shows one now.

Chat and UI options:
  -a, --agent <name>      Agent to start with (default: the first installed one; with --pack, the lead)
      --pack [lead:list]  Start a pack: omit the value to use all installed agents, or name them
                          explicitly, e.g. claude:codex,gemini. Follow its tasks in the chat; in
                          the tower, Ctrl+G opens approvals and proposed session messages
      --max-parallel <n>  Delegated tasks that can run at once with --pack (default: 4)
      --verify <command>  Test command on each pack task's card (default: the project's npm test script)
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
      --sessions          Give the agent read access to the session index. Ask what needs your
                          attention across agents with sessions_waiting
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
  const quick = ['help', 'version', 'update', 'self-install', 'install'].includes(command.kind);
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
    case 'send':
      return sendPrompt(cli, agents, command);
    case 'doctor':
      return checkStores(cli, agents, command);
    case 'sessions-mcp':
      return serveSessions(cli, agents, command);
    case 'hooks':
      return manageHooks(cli, command, updater);
    case 'notify':
      return manageNotify(cli, command);
    case 'limits':
      return showLimits(cli, command);
    case 'topics':
      return manageTopics(cli, agents, command);
    case 'answer':
      return answerQuestion(cli, command);
    case 'archive':
      return archiveCommand(cli, agents, command);
    case 'run':
      return runTask(cli, agents, command);
    case 'chat':
    case 'ui':
    case 'tower':
      return runUi(cli, agents, command);
    case 'embed':
      return runEmbed(cli, agents, command);
    case 'acp':
      return runAcp(cli, agents, command);
    case 'update':
      return runUpdate(cli, updater, command);
    case 'self-install':
      return runSelfInstall(cli, updater, command);
    case 'install':
      return runInstall(cli, updater, command);
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
        `or install the command, which updates itself:\n  npx genaicode install\n`,
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
    reportInstall(
      cli,
      selfInstall({ packageRoot: deps.packageRoot, binDir: options.binDir, force: options.force, env: cli.env }),
    );
    return EXIT_OK;
  } catch (error) {
    cli.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_FAILED;
  }
}

async function runInstall(
  cli: CliEnvironment,
  deps: UpdateDeps,
  options: Extract<CliCommand, { kind: 'install' }>,
): Promise<number> {
  try {
    cli.stderr.write('Installing genaicode with npm (no install scripts)...\n');
    const result = await installCommand(deps, options);
    reportInstall(cli, result);
    const shadow = shadowingCommand(cli.env, dirname(result.shim));
    if (shadow) {
      cli.stdout.write(
        `Note: "genaicode" on your PATH is ${shadow}, which comes before ${dirname(result.shim)}.\n` +
          'Remove it ("npm uninstall -g genaicode") or put that directory first on PATH.\n',
      );
    }
    cli.stdout.write(
      'Run "genaicode" to start. It checks for updates once a day; "genaicode update --auto off" turns that off.\n',
    );
    return EXIT_OK;
  } catch (error) {
    cli.stderr.write(`Install failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_FAILED;
  }
}

function reportInstall(cli: CliEnvironment, result: { version: string; shim: string; onPath: boolean }): void {
  cli.stdout.write(`Installed genaicode ${result.version}: ${result.shim}\n`);
  if (!result.onPath) {
    const dir = dirname(result.shim);
    cli.stdout.write(
      `${dir} is not on your PATH. Add it to your shell profile (~/.zshrc, ~/.bashrc):\n` +
        `  export PATH="${dir}:$PATH"\n`,
    );
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
  options: Extract<CliCommand, { kind: 'chat' | 'ui' | 'tower' }>,
  extra: Pick<UiLaunch, 'firstPrompt' | 'transformPrompt'> = {},
): Promise<number> {
  const tty = cli.tty ?? { stdin: process.stdin, stdout: process.stdout };
  if (options.kind !== 'ui' && !(cli.interactive ?? (tty.stdin.isTTY && tty.stdout.isTTY))) {
    cli.stderr.write(
      `genaicode ${options.kind} needs a terminal. Use "genaicode run" for scripts, or "genaicode ui".\n`,
    );
    return EXIT_USAGE;
  }
  // Sessions are read from every agent's store, not only from the agents this chat can run.
  const indexed = agentSessionSources(agents);
  let sessionAgents = agents;
  let towerInbox: TowerInbox | undefined;
  let startupNotice: string | undefined;
  let initial = options.agent;
  if (options.pack) {
    const spec = options.pack;
    if (options.mcpServers.some((server) => server.name === 'pack')) {
      cli.stderr.write('--pack already provides an MCP server named "pack". Give the --mcp server another name.\n');
      return EXIT_USAGE;
    }
    const packAgents =
      cli.agents ??
      agents.map((agent) => {
        if (agent.name === 'codex') return codexLive();
        if (agent.name === 'muse') return museLive();
        return agent;
      });
    const member = (name: string) => packAgents.find((agent) => agent.name === name)!;
    let lead: CodingAgent;
    let members: CodingAgent[];
    if ('auto' in spec) {
      const installed = detectAgents(packAgents, cli.env)
        .filter((found) => found.path !== null)
        .map((found) => found.agent);
      if (options.agent !== undefined) {
        if (!knownAgents(cli, agents, [options.agent], '--agent')) return EXIT_USAGE;
        lead = member(options.agent);
      } else {
        const picked = installed.find((agent) => agent.capabilities.mcp);
        if (!picked) {
          const mcpNames = packAgents
            .filter((agent) => agent.capabilities.mcp)
            .map((agent) => agent.name)
            .join(', ');
          const hint = mcpNames ? ` (needs one of: ${mcpNames})` : '';
          cli.stderr.write(`No installed agent with MCP support found for --pack${hint}.\n`);
          return EXIT_USAGE;
        }
        lead = picked;
      }
      if (!lead.capabilities.mcp) {
        cli.stderr.write(`Agent "${lead.name}" cannot lead a pack because it does not support MCP.\n`);
        return EXIT_USAGE;
      }
      // Every installed agent joins the pack (including the lead).
      members = installed.includes(lead) ? installed : [lead, ...installed];
      startupNotice = `Pack: ${lead.name} leads · members: ${members.map((agent) => agent.name).join(', ')}.`;
    } else {
      if (!knownAgents(cli, agents, [spec.lead, ...spec.members], '--pack')) return EXIT_USAGE;
      lead = member(spec.lead);
      if (!lead.capabilities.mcp) {
        cli.stderr.write(`Agent "${lead.name}" cannot lead a pack because it does not support MCP.\n`);
        return EXIT_USAGE;
      }
      members = spec.members.map(member);
    }
    if (options.sessions) {
      sessionAgents = packAgents;
      towerInbox = new TowerInbox(sessionAgents, cli.env);
    }
    const project = resolve(cli.cwd, options.cwd ?? '.');
    const projectDir = await fs.realpath(project).catch(() => project);
    const command = options.verify ?? (await npmTestCommand(projectDir));
    const team = pack({
      lead,
      members,
      maxParallel: spec.maxParallel,
      operatorMerge: true,
      sessionProposalTool: towerInbox?.proposalTool,
      verification: command
        ? {
            label: command,
            async run(cwd, signal, root) {
              const result = await worktreeCheck(command, cwd, root, projectDir, signal);
              return {
                ok: result.exitCode === 0,
                detail: [`Exit ${result.exitCode ?? 'by signal'}`, result.output.trim()].filter(Boolean).join('\n'),
              };
            },
          }
        : undefined,
    });
    agents = [team, ...agents];
    initial = team.name;
  }
  if (options.sessions && options.mcpServers.some((server) => server.name === 'sessions')) {
    cli.stderr.write('--sessions adds an MCP server named "sessions": give the --mcp one another name.\n');
    return EXIT_USAGE;
  }
  if (options.mcpServers.length || options.sessions) {
    // Only agents that take MCP servers can use them; offer just those.
    const chosen = agents.find((agent) => agent.name === initial);
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
  const tools = options.sessions ? sessionTools(indexed, { env: cli.env }) : undefined;
  const index = tools
    ? await startLocalMcpServer({
        name: 'sessions',
        tools,
        instructions: SESSION_TOOLS_INSTRUCTIONS,
      })
    : undefined;
  const mcpServers = [...options.mcpServers, ...(index ? [index.mcpServer] : [])];
  const launch: UiLaunch = {
    agents,
    sessionAgents,
    sessionSources: indexed,
    ...(tools ? { sessionTools: tools } : {}),
    ...(towerInbox ? { towerInbox } : {}),
    ...(options.kind === 'tower' ? { waitingOnStart: true } : {}),
    ...(startupNotice ? { startupNotice } : {}),
    agent: initial,
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
    return await (options.kind === 'ui' ? ui.runWeb(launch) : ui.runChat(launch));
  } finally {
    towerInbox?.close();
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

/** How a waiting session's last words are introduced, by what they ask (`SessionInfo.ending`). */
const ENDING_SAYS = {
  question: 'asks',
  command: 'wants you to run',
  offer: 'offers',
  unreported: 'could not report back',
  none: 'said',
} as const;

/** `sessions --waiting`: one line per session that waits for you, approvals first, with the command that continues it. */
function showWaiting(
  cli: CliEnvironment,
  sessions: readonly SessionInfo[],
  now: number,
  sinceMs?: number,
  questions: readonly PendingAsk[] = [],
): number {
  const period = sinceMs === undefined ? '' : ` in the last ${ago(sinceMs)}`;
  if (!sessions.length) {
    cli.stdout.write(`Nothing waits for you${period}.\n`);
    return EXIT_OK;
  }
  const asks = sessions.filter((session) => session.waitingFor === 'approval').length;
  const wants = sessions.filter((session) => session.waitingFor !== 'approval' && session.ending).length;
  cli.stdout.write(
    `${sessions.length} session${sessions.length === 1 ? '' : 's'} wait${sessions.length === 1 ? 's' : ''} for you${period}${asks ? `, ${asks} for approval` : ''}${wants ? `, ${wants} ask${wants === 1 ? 's' : ''} you something` : ''}:\n`,
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
          ? `${ENDING_SAYS[session.ending ?? 'none']}: ${oneLine(session.lastReply, 80)}`
          : 'your turn';
    const resume = resumeCommand(session);
    const commands = (session.waitingCommands ?? []).map(({ tool, command }) => `  ? ${tool}: ${command}\n`).join('');
    // Questions held open for the tower: what the tool would do, and how to answer.
    const open = asksForSession(questions, session)
      .map(
        (ask) =>
          `  ? ${ask.tool ?? 'a tool'}${ask.preview ? `: ${oneLine(ask.preview, 100)}` : ''}\n` +
          `    genaicode sessions approve ${ask.id}   (or: sessions deny ${ask.id} -m <why>)\n`,
      )
      .join('');
    cli.stdout.write(
      `\n${session.waitingFor === 'approval' ? '◆' : session.ending ? '●' : '○'} ${project || '(no directory)'}  ${session.agent}  ${ago(now - session.updatedAt)} ago\n  ${text}\n  ${what}\n${commands}${open}${resume ? `  ${resume}\n` : ''}`,
    );
  }
  return EXIT_OK;
}

async function answerQuestion(cli: CliEnvironment, command: Extract<CliCommand, { kind: 'answer' }>): Promise<number> {
  const decision: AskDecision =
    command.behavior === 'allow'
      ? { behavior: 'allow' }
      : { behavior: 'deny', ...(command.message !== undefined ? { message: command.message } : {}) };
  if (!(await answerAsk(command.id, decision, cli.env))) {
    cli.stderr.write(
      `No open question ${command.id}: it was answered already or its session moved on. See "genaicode sessions --waiting".\n`,
    );
    return EXIT_FAILED;
  }
  cli.stdout.write(`${command.behavior === 'allow' ? 'Approved' : 'Denied'}.\n`);
  return EXIT_OK;
}

/**
 * `limits`: how much of each agent's plan is used, as last seen, in the plan's own measure (share
 * of a window), never dollars. `limits record` is for Claude Code's status line: it keeps the
 * limits in the input and prints them as the line.
 */
async function showLimits(cli: CliEnvironment, command: Extract<CliCommand, { kind: 'limits' }>): Promise<number> {
  if (command.action === 'record') {
    let input: unknown;
    try {
      input = JSON.parse((await cli.readStdin()) ?? '');
    } catch {
      // Not a status line input: nothing to keep, and nothing to say in a status line.
      return EXIT_OK;
    }
    const limits = statusLineLimits(input);
    recordLimits('claude', limits, cli.env);
    if (limits.length) cli.stdout.write(`${limits.map(shortLimit).join(' · ')}\n`);
    return EXIT_OK;
  }
  const limits = await knownLimits(cli.env);
  if (command.json) {
    cli.stdout.write(`${JSON.stringify({ limits })}\n`);
    return EXIT_OK;
  }
  if (!limits.length) {
    cli.stdout.write(
      "No limits known yet. They are kept when an agent runs through genaicode, read from Codex's own\n" +
        'sessions, and from Claude Code\'s status line once it runs "genaicode limits record".\n',
    );
    return EXIT_OK;
  }
  cli.stdout.write(`${describeKnownLimits(limits).join('\n')}\n`);
  return EXIT_OK;
}

/** `topics` looks this far back unless told otherwise. */
const TOPICS_SINCE_MS = 30 * 24 * 3600_000;

/** What a sorting run asks for when no model is named: sorting titles needs no large one. */
const SORTING_MODEL: Record<string, string> = { claude: 'haiku' };

/**
 * `topics`: the sessions of every agent as pieces of work. An agent sorts them only when asked
 * (`refresh`, the sessions no topic has yet); what it decided is kept and yours to correct.
 */
async function manageTopics(
  cli: CliEnvironment,
  agents: readonly CodingAgent[],
  command: Extract<CliCommand, { kind: 'topics' }>,
): Promise<number> {
  const sources = agentSessionSources(agents);
  const query = { env: cli.env, ...(cli.signal ? { signal: cli.signal } : {}) };
  const store = await readTopics(cli.env);
  const named = (text: string) => {
    const topic = findTopic(store, text);
    if (!topic) cli.stderr.write(`No one topic "${text}". "genaicode topics" lists them, with their ids.\n`);
    return topic;
  };
  const count = (n: number) => `${n} session${n === 1 ? '' : 's'}`;

  if (command.action === 'rename') {
    const topic = named(command.topic);
    if (!topic) return EXIT_FAILED;
    await writeTopics(renameTopic(store, topic, command.name), cli.env);
    cli.stdout.write(`${topic.id} is now "${oneLine(command.name, 80)}".\n`);
    return EXIT_OK;
  }
  if (command.action === 'merge') {
    const from = named(command.from);
    const into = from && named(command.into);
    if (!from || !into) return EXIT_FAILED;
    if (from.id === into.id) {
      cli.stderr.write('Those are the same topic.\n');
      return EXIT_USAGE;
    }
    await writeTopics(mergeTopics(store, from, into), cli.env);
    cli.stdout.write(`"${from.name}" is now part of "${into.name}".\n`);
    return EXIT_OK;
  }
  if (command.action === 'move') {
    const found: SessionInfo[] = [];
    for (const id of command.ids) {
      let match: SessionInfo | undefined;
      try {
        match = (await findSession(sources, id, query))?.session;
      } catch (error) {
        cli.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return EXIT_USAGE;
      }
      if (!match) {
        cli.stderr.write(`No session "${id}". Ids are at the end of each line of "genaicode topics show <topic>".\n`);
        return EXIT_FAILED;
      }
      found.push(match);
    }
    const next: TopicStore = { ...store, topics: [...store.topics] };
    const topic = command.to === undefined ? undefined : (findTopic(next, command.to) ?? topicNamed(next, command.to));
    await writeTopics(moveSessions(next, found, topic), cli.env);
    cli.stdout.write(
      topic ? `${count(found.length)} now in "${topic.name}".\n` : `${count(found.length)} out of any topic.\n`,
    );
    return EXIT_OK;
  }

  const now = Date.now();
  const listing = await listSessions(sources, { ...query, since: now - (command.sinceMs ?? TOPICS_SINCE_MS) });
  for (const error of listing.errors) cli.stderr.write(`${error.source}: ${error.message}\n`);
  const period = ago(command.sinceMs ?? TOPICS_SINCE_MS);

  if (command.action === 'refresh') {
    // `--again`: what was sorted so far is dropped, your corrections with it; the runs noted stay.
    const before: TopicStore = command.again
      ? { topics: [], sessions: {}, ...(store.runs ? { runs: store.runs } : {}) }
      : store;
    // Sessions relayed from a claude.ai project go to the topic of that project: no agent is asked.
    const own = projectTopics(listing.sessions, before);
    if (own.placed || command.again) await writeTopics(own.store, cli.env);
    if (own.placed) {
      cli.stderr.write(`${count(own.placed)} placed by the claude.ai project they came from.\n`);
    }
    // Then by the project of the Codex desktop app they worked in, whichever agent it was.
    const folders = (await codexProjects({ env: cli.env })).map(({ id, name, roots }) => ({
      key: `codex:${id}`,
      name,
      roots,
    }));
    const filed = folderTopics(listing.sessions, own.store, folders);
    if (filed.placed) {
      await writeTopics(filed.store, cli.env);
      cli.stderr.write(`${count(filed.placed)} placed by the Codex project they worked in.\n`);
      own.store = filed.store;
      own.placed += filed.placed;
    }
    const todo = unsortedSessions(listing.sessions, own.store);
    if (!todo.length) {
      cli.stdout.write(
        own.placed
          ? `Sorted ${count(own.placed)} into ${own.store.topics.length} topic${own.store.topics.length === 1 ? '' : 's'}. See them with "genaicode topics".\n`
          : `Every session of the last ${period} has a topic.\n`,
      );
      return EXIT_OK;
    }
    const agent = pickAgent(cli, agents, command.agent);
    if (!agent) return EXIT_USAGE;
    const model = command.model ?? SORTING_MODEL[agent.name];
    const batches = topicsBatches(todo);
    cli.stderr.write(
      `Sorting ${count(todo.length)} with ${agent.name}${model ? ` (${model})` : ''}${batches.length > 1 ? `, ${batches.length} runs one after another` : ''}...\n`,
    );
    // An empty directory: the agent has nothing to read there, and is told to read nothing.
    const cwd = await fs.mkdtemp(join(tmpdir(), 'genaicode-topics-'));
    let current = own.store;
    let placed = own.placed;
    try {
      let done = 0;
      for (const batch of batches) {
        const run = agent.run({
          prompt: topicsPrompt(batch, current),
          cwd,
          env: cli.env,
          ...(model ? { model } : {}),
          ...(cli.signal ? { signal: cli.signal } : {}),
        });
        let said = '';
        for await (const event of run) if (event.type === 'message') said += `${event.text}\n`;
        const result = await run.result;
        // The run's own session is noted first, so no later refresh takes it for one of yours.
        const own = result.sessionId && agent.sessions ? `${agent.sessions.name}:${result.sessionId}` : undefined;
        if (own) await writeTopics(withTopicsRun(await readTopics(cli.env), own), cli.env);
        if (!result.ok) {
          cli.stderr.write(`${describeResult(agent.name, result)}\n`);
          return result.status === 'aborted' ? EXIT_ABORTED : EXIT_FAILED;
        }
        // The answer is read against what is kept now: topics may have been corrected meanwhile, and
        // a new topic gets an id that is free there.
        const sorted = sortedTopics(result.text ?? said, batch, await readTopics(cli.env));
        if (!sorted.placed) {
          cli.stderr.write(`${agent.name} gave no topics that could be read. Nothing more was sorted.\n`);
          return EXIT_FAILED;
        }
        current = sorted.store;
        await writeTopics(current, cli.env);
        placed += sorted.placed;
        done += batch.length;
        if (batches.length > 1) {
          cli.stderr.write(`  ${done} of ${todo.length} looked at, ${current.topics.length} topics so far\n`);
        }
      }
    } finally {
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => undefined);
      if (placed)
        cli.stdout.write(
          `Sorted ${count(placed)} into ${current.topics.length} topic${current.topics.length === 1 ? '' : 's'}. See them with "genaicode topics".\n`,
        );
    }
    return EXIT_OK;
  }

  const { topics, unsorted } = summarizeTopics(listing.sessions, store);
  if (command.topic !== undefined) {
    const topic = named(command.topic);
    if (!topic) return EXIT_FAILED;
    const sessions = topics.find((one) => one.id === topic.id)?.sessions ?? [];
    if (command.json) {
      for (const session of sessions) cli.stdout.write(`${JSON.stringify(session)}\n`);
      return EXIT_OK;
    }
    cli.stdout.write(`${topic.name} (${topic.id}): ${count(sessions.length)} in the last ${period}\n`);
    for (const session of sessions) {
      const label = session.title ?? session.lastPrompt ?? session.firstPrompt ?? '(no prompt)';
      const mark = session.state === 'active' ? '▶' : session.ending || session.waitingFor === 'approval' ? '●' : ' ';
      cli.stdout.write(
        `${mark} ${session.agent}  ${ago(now - session.updatedAt)} ago  ${oneLine(label, 70)}  ${session.id}\n`,
      );
    }
    return EXIT_OK;
  }
  if (command.json) {
    cli.stdout.write(
      `${JSON.stringify({
        topics: topics.map(({ sessions, ...topic }) => ({
          ...topic,
          sessions: sessions.map(({ source, id, agent, updatedAt, state }) => ({
            source,
            id,
            agent,
            updatedAt,
            state,
          })),
        })),
        unsorted: unsorted.length,
      })}\n`,
    );
    return EXIT_OK;
  }
  if (!topics.length) {
    cli.stdout.write(
      unsorted.length
        ? `No topics yet. "genaicode topics refresh" has an agent sort the ${count(unsorted.length)} of the last ${period}.\n`
        : `No sessions in the last ${period}.\n`,
    );
    return EXIT_OK;
  }
  const width = Math.min(48, Math.max(...topics.map((topic) => topic.name.length)));
  for (const topic of topics) {
    const agentsOf = Object.entries(topic.agents)
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name} ${n}`)
      .join(', ');
    const state = [topic.asking ? `${topic.asking} ask you` : '', topic.active ? `${topic.active} working` : '']
      .filter(Boolean)
      .join(', ');
    cli.stdout.write(
      `${topic.asking ? '●' : topic.active ? '▶' : ' '} ${oneLine(topic.name, width).padEnd(width)}  ${topic.id.padEnd(4)}  ${agentsOf}  ${ago(now - topic.updatedAt)} ago${state ? `  ${state}` : ''}\n`,
    );
  }
  if (unsorted.length) {
    cli.stdout.write(`${count(unsorted.length)} not sorted yet: "genaicode topics refresh" sorts them.\n`);
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
        // Asked for by name, an agent gets its hooks even when its CLI is not found: said so.
        if (!installedHere.get(agent)) {
          if (command.agent === undefined) {
            cli.stdout.write(`${agent}: not installed, skipped\n`);
            continue;
          }
          cli.stdout.write(`${agent}: its CLI is not found here; the hooks run once it is installed.\n`);
        }
        const answer = command.answer === true && ANSWER_AGENTS.includes(agent);
        const status = await installHooks(agent, { ...hookOptions, ...(answer ? { answer } : {}) });
        cli.stdout.write(`${agent}: hook added to ${status.file} (${status.events.join(', ')})\n`);
        if (answer) cli.stdout.write('  Questions can also be answered with "genaicode sessions approve|deny".\n');
        else if (command.answer) cli.stdout.write(`  --answer: not for ${agent}, its approvals stay in ${agent}.\n`);
        if (agent === 'codex') cli.stdout.write('  Codex runs it once you trust it: open Codex and use /hooks.\n');
        if (status.statusLine === 'genaicode')
          cli.stdout.write('  Its status line keeps your plan limits for "genaicode limits".\n');
        if (status.statusLine === 'other')
          cli.stdout.write(
            '  Your own status line stays. For "genaicode limits" to know Claude Code\'s plan limits, have it\n' +
              '  pass its input on to "genaicode limits record".\n',
          );
      } else if (command.action === 'uninstall') {
        const removed = await uninstallHooks(agent, hookOptions);
        cli.stdout.write(
          `${agent}: ${removed ? `hook removed from ${hooksFile(agent, cli.env)}` : 'no hook installed'}\n`,
        );
      } else {
        const status = await hooksStatus(agent, hookOptions);
        const state = status.missing
          ? `broken, ${status.missing} is gone: run "genaicode hooks install"`
          : status.installed
            ? 'installed'
            : status.events.length
              ? 'installed by another genaicode or incomplete: run "genaicode hooks install"'
              : 'not installed';
        const line = status.statusLine === 'genaicode' ? ', status line keeps limits' : '';
        cli.stdout.write(`${agent}: ${state}${status.answer ? ', answers from here' : ''}${line}  ${status.file}\n`);
      }
    } catch (error) {
      failed = true;
      cli.stderr.write(`${agent}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  if (command.action === 'status') {
    const live = await readLive(cli.env);
    // Ended ones are kept a while too, but are not open.
    const all = await fs
      .readdir(liveDir(cli.env))
      .then((names) => names.filter((name) => name.endsWith('.json')).length)
      .catch(() => 0);
    const ended = Math.max(0, all - live.size);
    cli.stdout.write(
      `${live.size} open session${live.size === 1 ? '' : 's'}${ended ? ` (and ${ended} ended)` : ''} reported in ${liveDir(cli.env)}\n`,
    );
  }
  return failed ? EXIT_FAILED : EXIT_OK;
}

const WATCH_EVERY_MS = 3000;
/** Every this many looks the session stores are read again, whatever the quick look says. */
const WATCH_FULL_EVERY = 5;

/**
 * What the hooks last wrote, cheaply: the questions held open and the live records with their
 * times. While it stays the same, a watch need not read every agent's store again.
 */
async function hookMark(env: NodeJS.ProcessEnv, questions: readonly PendingAsk[]): Promise<string> {
  const dir = liveDir(env);
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const times = await Promise.all(
    names.sort().map((name) =>
      fs.stat(join(dir, name)).then(
        (stat) => `${name}:${Math.round(stat.mtimeMs)}`,
        () => name,
      ),
    ),
  );
  return [...questions.map((ask) => ask.id).sort(), '', ...times].join('\n');
}

/** A topic as a watch reports it: what the desktop app's menu shows of it. */
interface WatchedTopic {
  id: string;
  name: string;
  /** Sessions of it in the listing. */
  sessions: number;
  asking: number;
  active: number;
}

/** At most this many topics go into a line of the watch: those that ask first, then the latest. */
const WATCHED_TOPICS = 12;

/** The topics of what a look listed, and the name of each session's topic by session key. */
function watchedTopics(
  listed: readonly SessionInfo[],
  store: TopicStore,
): { topics: WatchedTopic[]; topicOf: Map<string, string> } {
  const topicOf = new Map<string, string>();
  if (!store.topics.length) return { topics: [], topicOf };
  const { topics } = summarizeTopics(listed, store);
  for (const topic of topics) for (const session of topic.sessions) topicOf.set(archiveKey(session), topic.name);
  return {
    // No times: a line is printed when it changes, and work going on would change it at every look.
    topics: topics.slice(0, WATCHED_TOPICS).map(({ id, name, sessions, asking, active }) => ({
      id,
      name,
      sessions: sessions.length,
      asking,
      active,
    })),
    topicOf,
  };
}

/**
 * `sessions --waiting --json --watch`: one line `{"sessions":[...]}` now, and again whenever what
 * waits changes. For a program that shows it (the desktop app's menu bar): it reads lines instead
 * of starting the CLI again for every look. Ends on Ctrl-C, or with its stdin when asked to.
 *
 * Reading every store takes a moment where there are thousands of sessions, so most looks only ask
 * what the hooks wrote: a new question or live record brings a full look at once, a session that
 * merely finished its turn shows within `WATCH_FULL_EVERY` looks.
 */
async function watchWaiting(
  cli: CliEnvironment,
  exitWithStdin: boolean,
  look: () => Promise<{
    sessions: readonly SessionInfo[];
    questions: readonly PendingAsk[];
    errors: readonly { source: string; message: string }[];
    /** Everything the look listed, waiting or not: what the topics are counted from. */
    listed: readonly SessionInfo[];
  }>,
  withAsks: (session: SessionInfo, questions: readonly PendingAsk[]) => object,
): Promise<number> {
  const stop = new AbortController();
  const end = () => stop.abort();
  cli.signal?.addEventListener('abort', end, { once: true });
  if (cli.signal?.aborted) end();
  const input = exitWithStdin ? (cli.input ?? process.stdin) : undefined;
  input?.on('end', end).on('close', end).on('error', end).resume();
  let last: string | undefined;
  let said = '';
  let sessions: readonly SessionInfo[] = [];
  let limits: readonly KnownLimit[] = [];
  let topics: WatchedTopic[] = [];
  let topicOf = new Map<string, string>();
  let mark: string | undefined;
  let since = 0;
  try {
    while (!stop.signal.aborted) {
      let questions: readonly PendingAsk[] = await pendingAsks(cli.env);
      const now = await hookMark(cli.env, questions);
      if (stop.signal.aborted) break;
      since += 1;
      if (mark !== now || since >= WATCH_FULL_EVERY) {
        const full = await look();
        if (stop.signal.aborted) break;
        ({ questions } = full);
        // A menu shows who asks now: a thread left days ago, or one that merely ended, is not that.
        sessions = full.sessions.filter((session) => isAsking(session));
        limits = await knownLimits(cli.env);
        if (stop.signal.aborted) break;
        ({ topics, topicOf } = watchedTopics(full.listed, await readTopics(cli.env)));
        if (stop.signal.aborted) break;
        // The mark from before the read: what a hook wrote meanwhile brings the next look.
        mark = now;
        since = 0;
        // A store that cannot be read is said once, not on every look.
        const trouble = full.errors.map((error) => `${error.source}: ${error.message}\n`).join('');
        if (trouble !== said) cli.stderr.write(trouble);
        said = trouble;
      }
      const line = JSON.stringify({
        sessions: sessions.map((session) => {
          const topic = topicOf.get(archiveKey(session));
          return topic ? { ...withAsks(session, questions), topic } : withAsks(session, questions);
        }),
        ...(limits.length ? { limits } : {}),
        ...(topics.length ? { topics } : {}),
      });
      if (line !== last) cli.stdout.write(`${line}\n`);
      last = line;
      // Its own abort listener goes with the timer, so a watch left open for days keeps none.
      await new Promise<void>((done) => {
        const wake = () => {
          clearTimeout(timer);
          stop.signal.removeEventListener('abort', wake);
          done();
        };
        const timer = setTimeout(wake, cli.watchEveryMs ?? WATCH_EVERY_MS);
        stop.signal.addEventListener('abort', wake);
      });
    }
  } finally {
    cli.signal?.removeEventListener('abort', end);
    // Paused again, or a stdin still open would keep the process alive after Ctrl-C.
    input?.off('end', end).off('close', end).off('error', end).pause();
  }
  return EXIT_OK;
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
  // What waits is picked from everything listed, so the limit comes after; a week back by default.
  const sinceMs = command.sinceMs ?? (command.waiting ? WAITING_SINCE_MS : undefined);
  const look = async () => {
    const now = Date.now();
    // Archived sessions may take places in the listing: as many more are read, and left out after.
    const extra = command.archived || command.waiting ? 0 : (await readArchive(cli.env)).size;
    const listing = await listSessions(sources, {
      ...(command.waiting ? {} : { limit: command.limit + extra }),
      env: cli.env,
      ...(command.automated ? { automated: true } : {}),
      ...(command.cwd !== undefined ? { cwd: resolve(cli.cwd, command.cwd) } : {}),
      ...(sinceMs !== undefined ? { since: now - sinceMs } : {}),
      ...(cli.signal ? { signal: cli.signal } : {}),
    });
    // Archived sessions stay out unless asked for.
    const listed = command.archived ? listing.sessions : listing.sessions.filter((session) => !session.archived);
    const sessions = (command.waiting ? waitingSessions(listed) : listed).slice(0, command.limit);
    const questions = command.waiting ? await pendingAsks(cli.env) : [];
    return {
      now,
      sessions,
      questions,
      errors: listing.errors,
      hidden: listing.sessions.length - listed.length,
      listed,
    };
  };
  // `--waiting`: with the questions a session holds open for the tower (`hooks install --answer`).
  const withAsks = (session: SessionInfo, questions: readonly PendingAsk[]) => {
    const asks = asksForSession(questions, session).map(({ id, tool, preview, at }) => ({
      id,
      ...(tool ? { tool } : {}),
      ...(preview ? { preview } : {}),
      at,
    }));
    return asks.length ? { ...session, asks } : session;
  };
  if (command.watch) return watchWaiting(cli, command.exitWithStdin === true, look, withAsks);
  const { now, sessions, questions, errors, hidden } = await look();
  for (const error of errors) cli.stderr.write(`${error.source}: ${error.message}\n`);
  if (command.json) {
    for (const session of sessions) cli.stdout.write(`${JSON.stringify(withAsks(session, questions))}\n`);
    return EXIT_OK;
  }
  if (command.waiting) return showWaiting(cli, sessions, now, sinceMs, questions);
  const archivedNote = hidden ? `${hidden} archived not shown: --archived shows them.\n` : '';
  if (!sessions.length) {
    cli.stdout.write(`No sessions found.\n${archivedNote}`);
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
      const state = session.archived
        ? 'archived'
        : session.waitingFor === 'approval'
          ? 'approval'
          : (session.state ?? '');
      cli.stdout.write(
        `  ${STATE_MARK[state] ?? ' '} ${session.agent.padEnd(7)} ${ago(now - session.updatedAt).padStart(4)}  ${state.padEnd(10)}  ${text}  ${session.id}\n`,
      );
    }
  }
  cli.stdout.write('\n● active  ◆ asks for approval  ○ waiting for you  ◌ unfinished\n');
  if (archivedNote) cli.stdout.write(archivedNote);
  else if (staleSessions(sessions, STALE_MS, now).length) {
    cli.stdout.write('Put away the ones left for days with "genaicode sessions archive --stale".\n');
  }
  return EXIT_OK;
}

/** `sessions archive|unarchive`: put sessions away in genaicode, or bring them back. Their stores stay as they are. */
async function archiveCommand(
  cli: CliEnvironment,
  agents: readonly CodingAgent[],
  command: Extract<CliCommand, { kind: 'archive' }>,
): Promise<number> {
  const sources = agentSessionSources(
    agents.filter((agent) => command.agent === undefined || agent.name === command.agent),
  );
  if (!sources.length) {
    cli.stderr.write(`No session store for agent "${command.agent}".\n`);
    return EXIT_USAGE;
  }
  const now = Date.now();
  const query = { env: cli.env, ...(cli.signal ? { signal: cli.signal } : {}) };
  if (command.stale) {
    const olderMs = command.olderMs ?? STALE_MS;
    const listing = await listSessions(sources, query);
    for (const error of listing.errors) cli.stderr.write(`${error.source}: ${error.message}\n`);
    const stale = staleSessions(listing.sessions, olderMs, now);
    if (!stale.length) {
      cli.stdout.write(`No session left for ${ago(olderMs)} or more.\n`);
      return EXIT_OK;
    }
    await archiveSessions(stale, true, { env: cli.env, now });
    cli.stdout.write(
      `Archived ${stale.length} session${stale.length === 1 ? '' : 's'} left for ${ago(olderMs)} or more:\n`,
    );
    for (const session of stale) {
      const label = session.title ?? session.lastPrompt ?? session.firstPrompt ?? '(no prompt)';
      const place = session.cwd ?? '';
      const project = place.split(/[\\/]/).filter(Boolean).pop() ?? place;
      cli.stdout.write(
        `  ${project || '(no directory)'}  ${session.agent}  ${ago(now - session.updatedAt)} ago  ${oneLine(label, 60)}  ${session.id}\n`,
      );
    }
    cli.stdout.write('Bring one back with "genaicode sessions unarchive <id>"; any news in it brings it back too.\n');
    return EXIT_OK;
  }
  const found: SessionInfo[] = [];
  for (const id of command.ids) {
    let match: SessionInfo | undefined;
    try {
      match = (await findSession(sources, id, query))?.session;
    } catch (error) {
      cli.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return EXIT_USAGE;
    }
    if (!match) {
      cli.stderr.write(`No session "${id}". Ids are at the end of each line of "genaicode sessions".\n`);
      return EXIT_FAILED;
    }
    found.push(match);
  }
  const changed = await archiveSessions(found, command.archived, { env: cli.env, now });
  const verb = command.archived ? 'Archived' : 'Brought back';
  cli.stdout.write(`${verb} ${changed} session${changed === 1 ? '' : 's'}.\n`);
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

/** Variables the agent CLIs set in the shells they run commands in. */
const AGENT_SHELL_MARKERS = ['CLAUDECODE', 'CODEX_SANDBOX', 'CODEX_THREAD_ID', 'GEMINI_CLI', 'CURSOR_AGENT'];

async function sendPrompt(
  cli: CliEnvironment,
  agents: readonly CodingAgent[],
  command: Extract<CliCommand, { kind: 'send' }>,
): Promise<number> {
  // A person sends prompts to other sessions. This catches an agent doing it by accident, not on purpose.
  const marker = command.force ? undefined : AGENT_SHELL_MARKERS.find((name) => cli.env[name]);
  if (marker) {
    cli.stderr.write(
      `This shell belongs to a coding agent (${marker} is set). Prompts to other sessions are sent by a person: ` +
        'run "genaicode sessions send" in your own terminal, or pass --force.\n',
    );
    return EXIT_USAGE;
  }
  const prompt = command.prompt ?? (await cli.readStdin());
  if (!prompt?.trim()) {
    cli.stderr.write('Pass a prompt as arguments or on stdin.\n');
    return EXIT_USAGE;
  }
  const { id, agent, sandbox } = command;
  const owners = agent === undefined ? agents : agents.filter((candidate) => candidate.name === agent);
  if (!owners.length) {
    cli.stderr.write(`No session driver for "${agent}".\n`);
    return EXIT_USAGE;
  }
  try {
    if (command.detach) {
      const pid = await detachSend({ id, prompt, agent, sandbox }, cli.env, cli.signal);
      cli.stdout.write(`Session ${id} started in the background (PID ${pid}).\n`);
      return EXIT_OK;
    }
    const render = createRenderer(cli.stdout, cli.stderr);
    const result = await sendSession(owners, id, prompt, {
      env: cli.env,
      signal: cli.signal,
      permissions: sandbox ? { sandbox } : undefined,
      onEvent(event, session) {
        render(event);
        if (event.type === 'done') cli.stderr.write(`${describeResult(session.agent, event.result)}\n`);
      },
    });
    return exitCode(result);
  } catch (error) {
    cli.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return cli.signal?.aborted ? EXIT_ABORTED : EXIT_FAILED;
  }
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
  const runCheck: NonNullable<CliEnvironment['runCheck']> =
    cli.runCheck ?? ((command, cwd, env, signal) => runCheckProcess({ shellCommand: command }, cwd, env, signal));
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
  flag = '--fallback',
): boolean {
  const unknown = names?.find((name) => !agents.some((agent) => agent.name === name));
  if (unknown === undefined) return true;
  cli.stderr.write(`Unknown agent "${unknown}" in ${flag}. Known agents: ${agents.map((a) => a.name).join(', ')}.\n`);
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

async function npmTestCommand(cwd: string): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await fs.readFile(join(cwd, 'package.json'), 'utf8'));
    // Pin npm to the task directory even if the worker removes its manifest.
    if (typeof manifest?.scripts?.test === 'string' && manifest.scripts.test.trim()) return 'npm --prefix . test';
  } catch {
    // Projects without an npm test script can supply their command with --verify.
  }
  return undefined;
}

function packageVersion(): string {
  const require = createRequire(import.meta.url);
  return (require('../../package.json') as { version: string }).version;
}
