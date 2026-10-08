# Coding agents (`genaicode/agents`)

> Status: experimental in 2.x. The API may change in a minor release until it is marked
> stable in [semver.md](./semver.md).

`genaicode/agents` runs coding-agent CLIs (Claude Code, Codex, Muse) as child processes
behind one interface. It is the agent-side counterpart of `ModelProvider`. A driver
translates at the edge and does not own application policy.

## Scope

In scope:

- starting an installed agent CLI headlessly on a task (a prompt and a working directory),
- decoding each vendor's JSON event stream into one `AgentEvent` IR,
- a final `AgentResult` (status, final message, session id, usage),
- abort, timeout, and killing the whole process group,
- finding which agent CLIs are on `PATH`.

Out of scope, and left to application code:

- sandboxing, credentials, and billing, which belong to the agent itself,
- choosing an agent or model, retries, and verify-and-repair loops,
- prompts and repository tools. GenAIcode adds no agent loop of its own.

## Running a task

```ts
import { claude } from 'genaicode/agents';

const run = claude().run({
  prompt: 'Rename getUser to fetchUser across src/',
  cwd: '/work/repo',
  model: 'claude-sonnet-5', // optional; omit for the CLI default
  effort: 'high', // optional; see agent.capabilities.effort
  maxTurns: 40, // where capabilities.maxTurns is true
  timeoutMs: 30 * 60_000,
  signal: abortController.signal,
});

for await (const event of run) console.log(event);
const result = await run.result;
```

`run()` starts the process right away. You can iterate the run for events once, or just
await `result`. `abort()` or the task's `signal` stops the agent, and `result` then
settles with `status: 'aborted'`. `result` never rejects: spawn failures, a missing `cwd`,
timeouts, and agent-reported failures all come back as `status` with an `error` string.

Buffered events are bounded. Before you iterate, a run keeps only its newest events (about
8 MiB, at most 1,000). While you iterate, nothing is dropped: if you fall more than about
8 MiB behind, the agent's output stops being read until you catch up, so the agent waits for
you. So awaiting `result` inside the loop while far behind waits until you `abort()`.
Stopping iteration early discards the rest; `result` still settles.

`result.ok` is true only when the process exited 0 and the agent did not report a
failure of its own. A zero exit alone is not treated as success.

## Events

| Event                     | Meaning                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `session`                 | Agent session or thread id (use it to resume in the agent's own CLI) |
| `text-delta`              | Streamed assistant text                                              |
| `message`                 | A complete assistant message. The last one becomes `result.text`     |
| `tool-start` / `tool-end` | Tool use (`shell`, `Edit`, `server/tool` for MCP, ...)               |
| `file-change`             | Paths the agent reported editing                                     |
| `approval-request`        | The agent is waiting for a permission decision                       |
| `usage`                   | Token usage, plus `costUsd` when the agent reports it                |
| `error`                   | An error the agent reported                                          |
| `stderr`                  | Raw stderr chunk                                                     |
| `raw`                     | A stdout line that was not JSON                                      |
| `done`                    | Always last; carries the `AgentResult`                               |

Vendor events that have no mapping are dropped.

## Follow-up turns

`result.sessionId` names the agent's own session. Pass it as `resume` to continue that
session with a new prompt; the agent keeps the earlier turns as context:

```ts
const agent = claude();
const first = await agent.run({ prompt: 'Add a --dry-run flag', cwd }).result;
const next = await agent.run({ prompt: 'Now cover it with a test', cwd, resume: first.sessionId }).result;
```

`claude`, `codex`, `cursor`, `opencode` and `copilot` support it (`capabilities.resume`).
Other drivers fail the task before spawning anything rather than starting a fresh session.

## Chat sessions

`createAgentSession` keeps a conversation with one agent for chat front ends; the
`genaicode chat` and `genaicode ui` commands are built on it:

```ts
import { claude, createAgentSession } from 'genaicode/agents';

const session = createAgentSession({ agent: claude(), cwd: '/work/repo' });
session.subscribe((state) => render(state)); // a new immutable snapshot on every change
session.send('Add a --dry-run flag');
await session.idle();
session.send('Now cover it with a test'); // resumes the same agent session
```

- `state.turns[]` holds each prompt with its transcript: `text` (streamed, then final),
  `tool` (input, clipped output, error flag), `files`, `approval`, `input` (steered text)
  and `error` entries, plus the turn's `AgentResult`. Usage and cost add up in `state`.
- `send()` while a turn runs steers the agent when it supports `steer()`, and otherwise
  queues the prompt; queued prompts run in order. `stop()` aborts the turn and clears the
  queue.
- Approval requests wait in `state.approvals` until `approve(id, decision)`, unless
  `autoApprove` decides them. `stop()` denies whatever is pending.
- `setAgent()` switches agents between turns and starts a fresh agent session; `reset()`
  does the same for the current agent.
- `transformPrompt(text)` rewrites what reaches the agent (a briefing, a context prefix)
  while turns, the queue and steered input keep the text given to `send()`.
- `<AgentChat>` from `genaicode/react` renders `state` in a React page (see the README).

## Drivers

| Driver                | Command        | Mode                                     | Notes                                                                                     |
| --------------------- | -------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `claude(options?)`    | `claude`       | `-p --output-format stream-json`         | `permissionMode` defaults to `acceptEdits`; `allowedTools` / `disallowedTools`; approvals |
| `codex(options?)`     | `codex`        | `exec --json`                            | `sandbox` defaults to `workspace-write`; effort via `model_reasoning_effort`              |
| `muse(options?)`      | `muse`         | `exec --json --trust-workspace`          | `maxTurns` maps to `--max-model-steps`                                                    |
| `codexLive(options?)` | `codex`        | `app-server` (JSON-RPC)                  | `steer()`, approvals, MCP. See [Live sessions](#live-sessions-steering-and-approvals)     |
| `museLive(options?)`  | `muse`         | `serve` (JSON-RPC)                       | `steer()`, approvals. See [Live sessions](#live-sessions-steering-and-approvals)          |
| `gemini(options?)`    | `gemini`       | `--output-format stream-json --prompt=…` | `approvalMode` defaults to `auto_edit`; `--skip-trust` unless `trustWorkspace: false`     |
| `cursor(options?)`    | `cursor-agent` | `-p --output-format stream-json`         | `--force --approve-mcps` by default (`--trust` if `force: false`); `partialOutput`        |
| `opencode(options?)`  | `opencode`     | `run --format json`                      | `model` is `provider/model`; `effort` maps to `--variant`; `autoApprove` adds `--auto`    |
| `copilot(options?)`   | `copilot`      | `--output-format json --prompt=…`        | `--allow-all-tools --no-ask-user` by default; `allowTools` / `denyTools` patterns         |
| `vibe(options?)`      | `vibe`         | `--output streaming --prompt=…`          | `agent` defaults to `accept-edits`; `--trust`; `model` via `VIBE_ACTIVE_MODEL`            |
| `antigravity(opts?)`  | `agy`          | `--output-format stream-json --print`    | `mode` defaults to `accept-edits`; `--sandbox` unless `sandbox: false`                    |

Every driver accepts `command` to point at a specific executable. `task.extraArgs` is
inserted before the prompt for flags that have no portable field.

The agent uses whatever login it already has. For example, Claude Code bills an API key if
`ANTHROPIC_API_KEY` is set in `task.env`. Pass an explicit `env` when that matters.

## Live sessions: steering and approvals

`codexLive()` and `museLive()` talk JSON-RPC to the agent's own server (`codex app-server`,
`muse serve`) instead of running one headless command. The process stays up for the whole
task, so you can add input while it works:

```ts
import { codexLive } from 'genaicode/agents';

const run = codexLive().run({
  prompt: 'Migrate the date helpers to Temporal',
  cwd: '/work/repo',
  onApproval: (request) => (request.kind === 'file-change' ? 'approve' : 'deny'),
});

setTimeout(() => run.steer?.('Keep the old exports as deprecated aliases.'), 60_000);
const result = await run.result;
```

- `steer(text)` resolves once the agent acknowledges the input. It rejects after the task has
  ended, and when no acknowledgement arrives (the input may or may not have reached the agent).
- `onApproval` answers permission requests; see [Approvals](#approvals).
- The task ends when the agent reports its turn complete. The server is then stopped. An exit
  before that point is a failure, even with exit code 0.

## Approvals

`onApproval(request, signal)` answers the agent's permission prompts on drivers with
`capabilities.approvals`: `claude`, `codexLive`, `museLive`. It returns `'approve'` or
`'deny'`.

```ts
const run = claude().run({
  prompt: 'Run the tests and fix what fails',
  cwd: '/work/repo',
  onApproval: (request, signal) => askUser(request, signal), // your UI
});
```

- `request.kind` is `command`, `file-change` or `other`; `summary` is one line to show;
  `detail` is the vendor's whole request (the command with its working directory, the tool
  input, the requested permissions). Show `detail` before asking for a decision.
- `request.scope` says what approving grants. `once` (or absent): this one call. `turn`: the
  permissions in `detail` until the agent's current turn ends (Codex permission profiles).
- `signal` aborts when the answer is no longer needed: the agent withdrew the request, the
  turn ended, the process exited, or the task was stopped. Close the question then. A late
  answer counts as `deny`.
- No handler, a handler that throws, and an aborted signal all deny. Nothing is approved
  automatically. `approval-request` and `approval-resolved` events record each question.

Per agent:

- `claude()`: with `onApproval`, the driver serves Claude Code's `--permission-prompt-tool`
  from a private MCP endpoint on 127.0.0.1 (random port, random bearer token), next to the
  task's own `mcpServers`, and raises `MCP_TOOL_TIMEOUT` to a day unless `env` sets it. The
  permission mode still applies first (`acceptEdits` by default): only what it does not allow
  is asked. Approving allows exactly the input Claude asked about (`updatedInput` unchanged).
- `codexLive()`: runs with approval policy `on-request` when `onApproval` is set (`never`
  otherwise). Commands and file changes are answered `accept` / `decline`. A permission
  profile request (`item/permissions/requestApproval`) is asked with `scope: 'turn'`; approving
  grants the requested categories (those that are not null) for the turn, denying grants none.
  Requests from another thread or turn are rejected; `serverRequest/resolved` withdraws one.
- `museLive()`: answers with one of the choices Muse offers and the stage's requirement id.
  Approving picks the `once` choice; a request that only offers session-wide approval is
  denied. A multi-stage approval asks once per stage (later stages get ids like `ap-1/2`),
  however often a stage is delivered. `approval/resolved` withdraws an open question.

The protocol handlers are exported for apps that run their own driver or MCP server:

- `codexApprovals(session, ids)` and `museApprovals(session, ids, options?)` take a
  `LiveSession` and a function returning the current `{ session, turn }` ids. Hand them each
  request and notification first (`request()` returns `undefined`, `notification()` false,
  for methods they do not own) and call `close()` when the turn ends.
- `claudeApprovalTool(onApproval)` is the permission prompt tool as an MCP tool (`name`,
  `description`, `inputSchema`, `call(args, signal)`) to serve from the app's own MCP server;
  pass `claudeApprovalArgs(serverName)` to Claude and `claudeApprovalEnv(env)` in its env.
  Abort `signal` when the MCP caller disconnects. `startClaudeApprovalServer(onApproval)`
  serves the tool on its own endpoint instead.

## Custom live agents

For other JSON-RPC agents, `liveAgent({ name, command, args, drive })` provides the process,
an `RpcPeer`, event emission, the approval flow, and `setSteer()`. `drive(session)` runs the
protocol and resolves with `{ ok, error? }` when the turn ends.

## MCP servers

`task.mcpServers` attaches MCP servers for one task on drivers with `capabilities.mcp`
(`claude`, `codex`, `codexLive`, `copilot`):

```ts
await claude().run({
  prompt: 'Summarize open incidents',
  cwd,
  mcpServers: [
    { name: 'tickets', url: 'https://mcp.example.com/tickets', headers: { Authorization: `Bearer ${token}` } },
    { name: 'fs', command: 'mcp-fs', args: ['--root', cwd] },
  ],
}).result;
```

- Claude Code gets a temporary `--mcp-config` file (mode 0600, removed after the run). The
  servers' tools are pre-allowed with `--allowedTools mcp__<name>`, because a headless run
  cannot ask. Pass `allowMcpTools: false` to turn that off, or `strictMcpConfig: true` to
  ignore the user's own MCP config.
- Codex gets `-c mcp_servers.<name>.*` overrides. HTTP header values go through environment
  variables (`env_http_headers`), so they never appear in argv. A stdio server's `env` is set
  on Codex's own environment and forwarded by name (`env_vars`); two servers cannot use
  different values for the same variable.
- Copilot CLI gets a temporary `--additional-mcp-config @<file>` (mode 0600, removed after
  the run), added to the user's own MCP config. `--allow-all-tools` already covers the
  servers' tools; with `allowAllTools: false` each server is pre-allowed with
  `--allow-tool=<name>` unless `allowMcpTools: false`.
- A driver without MCP support fails the task before spawning anything, instead of silently
  dropping the servers. Server names must match `/^[A-Za-z0-9_-]+$/`.

## Environment

The child inherits `task.env ?? process.env`. If your process holds model-provider keys that
the agent should not bill, pass a scrubbed copy:

```ts
import { scrubEnv, withoutProviderCredentials } from 'genaicode/agents';

claude().run({ prompt, cwd, env: withoutProviderCredentials() }); // agent uses its own login
scrubEnv(process.env, { names: [/^MYAPP_/], values: [/^sk_live_/] });
```

## Verify and repair

`runWithVerify` is an opt-in loop. It runs the task, then your check. If the check fails,
it runs the agent again with the failure report, up to `maxRepairs` times (default 2):

```ts
import { runWithVerify } from 'genaicode/agents';

const outcome = await runWithVerify(
  codex(),
  { prompt, cwd },
  {
    verify: async () => {
      const { code, output } = await runTests(cwd); // your own check
      return { ok: code === 0, detail: output.slice(-4000) };
    },
  },
);
// outcome: { ok, attempts: [{ prompt, result, report }], error? }
```

Every attempt is a fresh `run()` on the same working tree. The default repair prompt marks
the report as tool output. Pass `repairPrompt` to write your own.

## Discovery

```ts
import { claude, codex, muse, detectAgents } from 'genaicode/agents';

detectAgents([claude(), codex(), muse()]);
// [{ agent, path: '/usr/local/bin/claude' }, { agent, path: null }, ...]
```

Discovery checks only that the executable is present. Whether the agent is logged in, or
supports a given flag, shows up when the run fails.

## Hosted agents

Tasks can also run on a vendor's machines instead of a local process. Implement
`HostedAgentProvider` (`start`, `poll`, `cancel`, and optionally `send`) and wrap it with
`hostedAgent()` to get the same `CodingAgent` API:

```ts
import { hostedAgent, type HostedAgentProvider } from 'genaicode/agents';

const provider: HostedAgentProvider = {
  name: 'my-cloud-agent',
  start: (task, signal) => api.createTask({ repo: task.cwd, prompt: task.prompt }, { signal }),
  poll: (id, cursor, signal) => api.getTask(id, { after: cursor, signal }), // { state, events?, cursor?, error? }
  send: (id, text) => api.message(id, text),
  cancel: (id) => api.cancel(id),
};

const run = hostedAgent(provider, { pollIntervalMs: 10_000 }).run({ prompt, cwd: 'org/repo' });
```

`cwd` is passed to the provider as its workspace reference, such as a repository or branch.
`env`, `signal`, `timeoutMs` and `onApproval` stay local. Abort and timeout call `cancel`.
`send` backs `steer()`.

## Writing a driver

```ts
import { cliAgent } from 'genaicode/agents';

export const myAgent = cliAgent({
  name: 'my-agent',
  command: 'my-agent',
  capabilities: { effort: ['low', 'high'] },
  args: (task) => ['run', '--json', ...(task.model ? ['--model', task.model] : []), task.prompt],
  createParser() {
    let ok: boolean | undefined;
    return {
      event(value) {
        // Called with each JSON stdout line; return zero or more AgentEvents.
        const event = value as { kind?: string; text?: string };
        if (event.kind === 'say' && event.text) return [{ type: 'message', text: event.text }];
        if (event.kind === 'end') ok = true;
        return [];
      },
      outcome: () => (ok === undefined ? undefined : { ok }),
    };
  },
});
```

`createParser()` is called once per run, so a parser can keep state such as tool-id-to-name
maps. Parsers are pure, so you can unit test them by feeding recorded JSON lines, the same
way the built-in drivers are tested.

## Roadmap

1. Headless drivers for claude, codex, and muse, the event IR, and discovery. Done.
2. Live sessions (`codex app-server`, `muse serve`): `steer()` mid-task, approval replies. Done.
3. MCP server injection per driver, an env scrub helper, and an opt-in verify/repair helper. Done.
4. More CLIs (gemini, cursor, opencode) and a hosted coding-agent seam (`hostedAgent`). Done.
5. A Copilot CLI driver (`copilot`). Done.
