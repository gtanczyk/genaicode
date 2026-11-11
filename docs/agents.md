# Coding agents (`genaicode/agents`)

> Status: experimental in 2.x. The API may change in a minor release until it is marked
> stable in [semver.md](./semver.md).

`genaicode/agents` runs coding-agent CLIs (Claude Code, Codex, Muse) as child processes
behind one interface. It is the agent-side counterpart of `ModelProvider`. A driver
translates at the edge and does not own application policy.

## Quick look

`genaicode/agents` turns the coding-agent CLIs installed on a machine into one API. Give
any of them a task (a prompt and a working directory) and get back the same event stream
and result, whichever agent does the work. It is how you script, compare, or chain coding
agents from a job, a bot, or a CI step without writing a parser per vendor.

```ts
import { claude, codex, copilot, cursor, detectAgents } from 'genaicode/agents';

const [found] = detectAgents([claude(), codex(), copilot(), cursor()]).filter(({ path }) => path);
if (!found) throw new Error('No coding agent installed.');

const run = found.agent.run({ prompt: 'Add a unit test for parseDate', cwd: '/path/to/repo', timeoutMs: 20 * 60_000 });
for await (const event of run) {
  if (event.type === 'tool-start') console.log('⚙', event.name);
  if (event.type === 'file-change') console.log('edited', event.paths.join(', '));
}
const result = await run.result; // { status, ok, text, sessionId, usage, error, ... }
```

| Agent            | Driver                        | Extras                                             |
| ---------------- | ----------------------------- | -------------------------------------------------- |
| Claude Code      | `claude()`                    | `steer()`, MCP, approvals, max turns, effort       |
| Codex            | `codex()`, `codexLive()`      | MCP servers; live: `steer()`, approvals            |
| GitHub Copilot   | `copilot()`                   | MCP servers, allow/deny tool patterns              |
| Cursor           | `cursor()`                    | streamed text deltas                               |
| Gemini CLI       | `gemini()`                    | approval mode                                      |
| opencode         | `opencode()`                  | `provider/model` ids, variants                     |
| Mistral Vibe     | `vibe()`                      | agent profile, max turns, max price                |
| Antigravity CLI  | `antigravity()`               | `steer()`, MCP, approvals, sandbox, effort, usage  |
| Muse             | `muse()`, `museLive()`        | MCP servers, max turns; live: `steer()`, approvals |
| Your own CLI/API | `cliAgent()`, `hostedAgent()` | plug in any JSON-lines CLI or hosted agent         |

On top of the drivers:

- **Steer a running task** with `run.steer(text)` (Claude and the live drivers), and answer permission
  prompts with `onApproval` (Claude, Antigravity, live Codex and Muse).
- **Pick approval and sandbox policy** with `permissions: { approval, sandbox }` (or
  `'yolo'`); each driver maps it to the agent's own flags and refuses what it cannot honor.
- **Attach MCP servers per task** with `mcpServers`. Header secrets stay out of argv.
- **Verify and repair**: `runWithVerify` runs your check (tests, lint) after the agent and
  sends failures back for another attempt.
- **Keep credentials apart**: `withoutProviderCredentials()` strips your app's LLM API keys
  from the agent's environment, so it bills its own login.

Importing `genaicode` never spawns anything; only `genaicode/agents` does. The agent uses
its own credentials and billing, and its own permission settings unless `permissions` sets
them; any sandbox is the agent's own. GenAIcode does not choose a model or retry it. See the sections below for events, options per
driver, and writing your own driver.

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
| `rate-limit`              | A plan or account limit: window, status, % used, reset time          |
| `budget-warning`          | The run crossed `warnAt` of a `task.budget` cap                      |
| `failover`                | `withFallback()` moved the task to the next agent (`from`, `to`)     |
| `error`                   | An error the agent reported                                          |
| `stderr`                  | Raw stderr chunk                                                     |
| `raw`                     | A stdout line that was not JSON                                      |
| `done`                    | Always last; carries the `AgentResult`                               |

Vendor events that have no mapping are dropped.

## Usage, limits and budgets

Every driver except `muse`, `museLive` and `vibe` reports token usage (`usage` events,
`result.usage`); `claude` and `opencode` also report cost (`costUsd`), so a cost cap works for
them (and for `vibe`, natively). Usage reports are running
totals for the run, not increments.

**Plan limits.** `claude` and `codexLive` say how much of the subscription is left
(`capabilities.rateLimits`) with `rate-limit` events:

```ts
{ type: 'rate-limit', limit: { window: '5h', status: 'warning', usedPercent: 83, resetsAt: 1794571200000 } }
```

`window` is `5h`, `7d`, `7d-opus`, `7d-sonnet`, `overage` (Claude) or the Codex window length.
`status` is `warning` when the vendor flags it or from 80% used, and `exceeded` when requests are
refused. Codex names a per-model limit in `name`. For any agent, an error that says a quota or
rate limit ran out (429, `quota`, `rate limit`, `usage limit`...) adds one
`{ window: 'quota', status: 'exceeded' }` event, so front ends can say why the agent stopped.

**Budgets.** `task.budget` caps one run:

```ts
const run = agent.run({ prompt, cwd, budget: { maxTokens: 200_000, maxCostUsd: 2, warnAt: 0.8 } });
```

Past `warnAt` (default 0.8) of a cap the run emits one `budget-warning` per cap; past the cap
genaicode stops the agent and the run fails with `error: "claude went over its cost budget
($2.0412 of $2)."`. Tokens count `totalTokens`, else input + output. The check runs on the
agent's usage reports, so an agent that reports usage only at the end (`claude`, `gemini`,
`copilot`) can overshoot within that turn. `claude` also gets `--max-budget-usd` and `vibe`
`--max-price` for the cost cap, which stop it from the inside. `runWithVerify` spreads the
budget over all attempts.

`createAgentSession({ budget })` caps the whole session: each turn runs with what is left, and
once a cap is used up new prompts fail without starting (`setBudget()` changes it). The session
keeps `state.budget` and the latest report per limit in `state.rateLimits`. `limitChips(state)`
from `genaicode/react` turns both into short labels with a level (`ok`, `warning`,
`exceeded`); `<AgentChat>`, `genaicode chat` and `genaicode ui` show them next to usage, yellow
when close and red when out. `genaicode run|chat|ui --max-tokens <n> --max-cost <usd>` set
budgets from the command line.

## Failover

When a run fails, `result.failure` says whether the agent was at fault rather than the task:

| `failure.kind` | When                                                                      |
| -------------- | ------------------------------------------------------------------------- |
| `quota`        | A plan, account or API limit ran out (`resetsAt` when the vendor said)    |
| `auth`         | The CLI is not signed in, or its key was refused                          |
| `unavailable`  | The CLI is not installed (`ENOENT`)                                       |
| `crash`        | The CLI died, was killed, or exited non-zero without reporting any result |
| `budget`       | The run went over its `task.budget`                                       |

An ordinary failure (tests still red, max turns, an error the agent reported) has no `failure`.
`shouldFailOver(result)` is true for the first four: another agent can get past them, while a
spent budget is the user's own cap.

Failover is opt-in, and the user picks the agents:

```ts
const agent = withFallback([claude(), codex(), gemini()]);
const result = await agent.run({ prompt, cwd }).result; // claude; codex if claude is out; then gemini
```

Each agent is tried at most once per run, and gets the task without `resume`. A `failover` event
marks each switch. An agent that ran out goes last in later runs until it completes one, so
`runWithVerify(withFallback([...]), ...)` does not hit the same limit on every repair. A stop, a
spent budget and any other failure end the run as they are.

Sessions do the same with `createAgentSession({ fallback: [codex(), gemini()] })` (`setFallback()`
changes the list, `state.fallback` shows it). When a turn fails over, its transcript ends with a
`{ kind: 'failover', from, to, failure }` entry, the session switches to the next agent it has not
tried for that prompt and runs the prompt again there. If the first agent had already changed
files, the next one is told which. The new agent stays for later turns; the model is cleared
(another vendor's model id means nothing to it). The new agent starts its own session; `failoverPrompt(prompt, earlier)` can rewrite what it gets, e.g.
to brief it again (app agents do: the briefing plus the conversation so far). `createAppAgent({ fallback: ['codex'] })` and
`configure({ fallback })` take agent names. `genaicode run|chat|ui --fallback codex,gemini` and
`/fallback` in the chat do it from the command line, and `<AgentChat>`, `chat` and `ui` show the
switch in the transcript.

## Follow-up turns

`result.sessionId` names the agent's own session. Pass it as `resume` to continue that
session with a new prompt; the agent keeps the earlier turns as context:

```ts
const agent = claude();
const first = await agent.run({ prompt: 'Add a --dry-run flag', cwd }).result;
const next = await agent.run({ prompt: 'Now cover it with a test', cwd, resume: first.sessionId }).result;
```

`claude`, `codex`, `cursor`, `opencode`, `copilot`, `antigravity` and `museLive` support it (`capabilities.resume`).
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
- `setAgent()` (and a failover) switches agents and hands the conversation over: the next agent's first
  prompt starts with a recap of the turns it missed and the path of a Markdown transcript
  (tool calls, output, changed files) written to `.genaicode/handoff/` in the cwd (git-ignored),
  for it to read when the recap is not enough. Switching back to an agent resumes its own
  session and tells it only what it missed. `setAgent(agent, { handoff: false })`, or
  `handoff: false` in the options, starts the agent fresh; `handoff: { dir }` moves the
  transcripts. `turn.handoff` records what a turn was told. `reset()` forgets every agent
  session, with no handoff.
- `transformPrompt(text)` rewrites what reaches the agent (a briefing, a context prefix)
  while turns, the queue and steered input keep the text given to `send()`.
- `<AgentChat>` from `genaicode/react` renders `state` in a React page (see the README).

### Artifacts

An agent can publish something for the user to look at instead of describing it: a report or
chart as a self-contained HTML page, an image, a Markdown document. `genaicode chat` and
`genaicode ui` turn this on by default (`--no-artifacts` turns it off); in code:

```ts
import { artifactResponse, createAgentSession, startArtifactChannel } from 'genaicode/agents';

const artifacts = await startArtifactChannel({ cwd });
const session = createAgentSession({ agent: claude(), cwd, artifacts });

// Your server shows the content. The id is unguessable; serve it without your session cookie in mind.
app.get('/artifacts/:id', (req, res) => {
  const found = artifacts.store.read(req.params.id);
  if (!found) return res.status(404).end();
  // The Range header lets audio and video seek.
  const { status, headers, body } = artifactResponse(found.artifact, found.body, { range: req.headers.range });
  res.writeHead(status, headers).end(body);
});
```

- The agent gets one MCP tool, `publish_artifact({ title, path | content + format, name? })`, on
  a loopback MCP server behind a bearer token. So it works for the agents that take MCP servers
  in genaicode (claude, codex, codexLive, copilot, muse, museLive, antigravity); the others
  simply do not get the tool. An app with its own MCP server can mount `store.tool()` there
  and pass `{ store }` alone; `createAppAgent` does exactly that (see [app-agent.md](app-agent.md)).
- Each publish adds an `artifact` entry (`{ id, title, kind, mimeType, bytes, version, path? }`)
  to the running turn. The content is copied into memory at that moment (5 MB each, 50 MB for
  audio and video, the newest 30 and 200 MB in all by default: `maxBytes`, `maxMediaBytes`,
  `maxArtifacts`, `maxTotalBytes`); publishing the same `name` again replaces it and keeps the `id`.
- `<AgentChat artifactUrl={(a) => `/artifacts/${a.id}?v=${a.version}`}>` shows a card with a
  preview; the terminal chat shows a line and `/web` opens the browser.
- **Media**: files ending in png, jpg, gif, webp, avif or svg show as a picture (screenshots),
  mp3, wav, ogg, opus, m4a, aac or flac in an audio player, mp4, m4v, webm, mov or ogv in a
  video player. Media is published from a file (`path`), not as `content`. Your page's own
  Content-Security-Policy has to allow `img-src`, `media-src` and `frame-src` for the address
  you serve artifacts at.
- **Pages that answer back**: a published page can ask the user something (a questionnaire, a
  choice between mockups) and hand the answer to the agent by calling
  `parent.postMessage({ genaicode: 'submit', data }, '*')`, e.g. from a button. `<AgentChat>`
  takes that only from the frame of that card, shows the user the JSON that would be sent and
  waits for **Send to agent**; then `onArtifactSubmit(artifact, data)` runs, by default
  `onSend(artifactSubmission(artifact, data))`, so the agent reads it as the user's next
  message. Pass `onArtifactSubmit={null}` to turn it off. Nothing is sent without that click,
  and a page opened in a tab of its own has nobody to send to.
- **Other agents**: the store belongs to the session, not the agent. After `setAgent()` or a
  failover the cards still open, the next agent gets the same tool, and its handoff lists what
  was published (title, `name`, kind, version, source file) so it can replace an artifact under
  the same `name`. Pages and documents that were published as `content` are written into the
  handoff transcript, since they exist nowhere else.

Artifacts are agent-written content, so they are handled as untrusted:

- **Files**: only regular files inside `cwd` after resolving symlinks; `.git`, `.genaicode`,
  `.ssh` and similar folders, `.env*`, key and certificate files are refused. This guards
  against a confused or prompt-injected agent, not against one with a shell, which can read
  those files anyway.
- **Types**: the MIME type comes from the file extension or `format`, never from the agent,
  and everything is sent with `nosniff`. Unknown types download instead of rendering.
- **HTML**: `artifactResponse()` sends a Content-Security-Policy with `sandbox allow-scripts`
  and `default-src 'none'`: the page runs its own inline code in an origin of its own (no
  cookies, storage or DOM of your app, also when its URL is opened directly) and loads
  nothing from the network, so no CDN scripts either. `<AgentChat>` adds the same sandbox on
  the frame. SVG is shown as an image, or with scripts off when opened directly.
- **Answers from a page** are data from agent-written code: they reach the agent only after
  the user saw and confirmed them, at most 20 KB of JSON at a time.
- **What is left**: a page can still navigate its own frame to another site and carry data in
  that URL; browsers offer no switch for that. The page only knows what the agent put in it,
  but treat a published page like a link the agent sent you.

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
| `antigravity(opts?)`  | `agy`          | `acp` (JSON-RPC)                         | `steer()`, approvals, MCP, resume; `mode` defaults to `accept-edits`; `--sandbox`         |

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
- `claude()` steers too, without a server: it writes the prompt to Claude Code as
  `--input-format stream-json`, and each steer is one more user message that Claude reads
  between tool calls of the running turn. `steer(text)` resolves once Claude takes it; a steer
  that arrives as the turn ends runs as one more turn of the same task. `claude({ steer: false })`
  passes the prompt as an argument instead.
- The task ends when the agent reports its turn complete. The server is then stopped. An exit
  before that point is a failure, even with exit code 0.

## Approvals

`onApproval(request, signal)` answers the agent's permission prompts on drivers with
`capabilities.approvals`: `claude`, `codexLive`, `museLive`, `antigravity`. It returns `'approve'` or
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
  automatically unless `permissions.approval` says so (see [Permissions](#permissions)).
  `approval-request` and `approval-resolved` events record each question.

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
- `antigravity()`: answers ACP `session/request_permission` requests (`allow_once` or
  `reject_once`) for tools not pre-allowed by the session mode (`accept-edits` by default).

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

## Permissions

`task.permissions` picks the approval policy and the sandbox in one place, and each driver
translates it into the agent's own options. An omitted field keeps the driver's default (the
behavior described above); `'yolo'` is `{ approval: 'auto-approve', sandbox: 'unrestricted' }`.

```ts
claude().run({ prompt, cwd, permissions: { approval: 'auto-approve', sandbox: 'workspace-write' } });
codexLive().run({ prompt, cwd, permissions: 'yolo' });
```

- `approval`: `ask` sends prompts to `onApproval` (required then). `auto-approve` approves each
  prompt without asking, for exactly the scope the agent asked for (one call, or a Codex
  profile for the turn; never a session-wide grant). `deny` refuses whatever would need a
  prompt and does not call `onApproval`.
- `sandbox`: `workspace-write` turns on the agent's own sandbox (writes limited to `cwd`;
  network rules are the vendor's), `read-only` its read-only mode, `unrestricted` no sandbox,
  even when the agent's settings enable one. `auto-approve` never grants a step outside the
  sandbox. With `ask`, Claude refuses such steps before asking and Codex permission profiles
  (which widen the sandbox) are denied; a Codex command or file-change approval stays the
  person's call, as in Codex itself, so approving it may let that one step leave the sandbox.
- `capabilities.permissions` lists the values a driver accepts. Anything else, and any
  combination the agent cannot honor, fails the run with `status: 'failed'` and an `error`
  naming the value before the agent starts. Setting both a permissions field and the driver
  option it replaces (`permissionMode`, `sandbox`, `approvalMode`, `force`...) is an error too.
- Where genaicode sees the prompt (Claude's prompt tool, Muse), `auto-approve` and policy
  denials still emit `approval-request` and `approval-resolved` with `automatic: true`, and
  `createAgentSession` shows them as transcript entries. Agents that approve by themselves
  (Codex with policy `never`, Gemini `yolo`, Cursor `--force`...) report nothing to show.

| Driver          | approval                | sandbox                                  | Translation                                                                                                                                                                                                    |
| --------------- | ----------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude()`      | ask, auto-approve, deny | workspace-write, read-only, unrestricted | `ask` / `auto-approve`: the prompt tool; `deny`: none. `workspace-write`: Claude's sandbox via `--settings` (required, no per-command escape), `acceptEdits`; `read-only`: `plan`; `unrestricted`: sandbox off |
| `codex()`       | auto-approve, deny      | workspace-write, read-only, unrestricted | `approval_policy="never"` (exec never asks); `--sandbox` read-only / workspace-write / danger-full-access                                                                                                      |
| `codexLive()`   | ask, auto-approve, deny | workspace-write, read-only, unrestricted | `ask`: policy `on-request`, otherwise `never`; `thread/start` sandbox as above                                                                                                                                 |
| `museLive()`    | ask, auto-approve, deny | unrestricted                             | `ask` / `auto-approve`: approval mode `onRequest` (the `once` choice); `deny`: `denyUnmatched`. Muse has no sandbox                                                                                            |
| `gemini()`      | auto-approve, deny      | workspace-write, read-only, unrestricted | `--approval-mode yolo` / `auto_edit`; `read-only`: `plan` (not with `auto-approve`); `--sandbox` / `--no-sandbox` plus `GEMINI_SANDBOX`, which overrides the flag in Gemini                                    |
| `cursor()`      | auto-approve, deny      | workspace-write, read-only, unrestricted | `auto-approve`: `--force`, which runs commands unsandboxed, so only with `unrestricted`; `deny`: `--trust`; `--sandbox enabled` / `disabled`; `read-only`: `--mode ask`                                        |
| `copilot()`     | auto-approve            | unrestricted                             | `--allow-all-tools` (prompt mode needs it); `--allow-all-paths --allow-all-urls`. Copilot's `--sandbox` lets a command opt out of it, so `workspace-write` is not offered                                      |
| `opencode()`    | auto-approve, deny      | unrestricted                             | `--auto`; opencode has no sandbox                                                                                                                                                                              |
| `vibe()`        | auto-approve, deny      | read-only, unrestricted                  | `--auto-approve`; `read-only`: `--agent plan` (not with `auto-approve`); no sandbox                                                                                                                            |
| `antigravity()` | ask, auto-approve, deny | workspace-write, unrestricted            | `ask` / `auto-approve` / `deny` answer ACP `session/request_permission` (`allow_once` / `reject_once`); `--sandbox` on or off (`antigravityPermissionFlags` maps print-mode `--dangerously-skip-permissions`)  |
| `muse()`        | none                    | none                                     |                                                                                                                                                                                                                |

Claude in `read-only` writes nothing in the workspace, but plan mode may still save its plan
under `~/.claude/plans`. In `workspace-write`, Claude's sandbox covers Bash; edits through its
file tools are accepted inside `cwd` and denied outside it.

For apps that keep their own argument lists (an adapters file, say),
`applyPermissionArgs(agent, args, permissions)` returns `{ args, env }` with the flags the
translation owns replaced, using the same per-agent functions (`claudePermissionFlags`,
`codexPermissionFlags`, `geminiPermissionFlags`, `cursorPermissionFlags`,
`copilotPermissionFlags`, `opencodePermissionFlags`, `vibePermissionFlags`,
`antigravityPermissionFlags`; `codexThreadPolicy` for the app server). For Claude, `ask` and
`auto-approve` also need the prompt tool: `claudeApprovalTool(handler, { sandbox, cwd })`
denies requests outside the sandbox before asking, and `decideApproval(task, request, signal)`
applies the approval policy the way the drivers do.

## Custom live agents

For other JSON-RPC agents, `liveAgent({ name, command, args, drive })` provides the process,
an `RpcPeer`, event emission, the approval flow, and `setSteer()`. `drive(session)` runs the
protocol and resolves with `{ ok, error? }` when the turn ends.

## MCP servers

`task.mcpServers` attaches MCP servers for one task on drivers with `capabilities.mcp`
(`claude`, `codex`, `codexLive`, `copilot`, `muse`, `museLive`, `antigravity`):

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
- Muse Code (`muse exec`, `muse serve`) gets repeatable `-c mcp_servers.<name>.*` overrides
  (`transport` `streamable_http` or `stdio`, `url`, `command`, `args`). Header values and a
  stdio server's `env` values go through environment variables that the overrides name as a
  whole-value `${VAR}`, which Muse expands, so they never appear in argv. Needs Muse Code
  1.4.4 or newer (checked with 1.4.13). Under `museLive()` with `permissions.approval: 'ask'`
  every MCP tool call is an approval request: answer it in `onApproval`.
- Antigravity CLI (`agy acp`, 1.5.0+) receives the task's HTTP and stdio servers in the
  JSON-RPC `session/new` / `session/resume` request over stdin, so secret headers and env
  values never appear in argv or on disk, and pre-allows the attached servers' tools for the
  session. Checked with agy 1.5.0: MCP tool calls never reach `onApproval`, even with
  `permissions.approval: 'ask'` (only commands and file edits are asked about); tools are named
  `mcp_<server>_<tool>`; the tool's result is not in the transcript (agy sends no output for
  it); and agy adds its own `toolSummary` field to the tool arguments, so a server with a
  strict input schema must accept or ignore it.
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
