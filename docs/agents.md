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
- choosing an agent or model (`pack()` leaves that to its lead agent), retries, and verify-and-repair loops,
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

## Packs: one agent over the others

`pack()` turns the agents on a machine into one `CodingAgent`. The lead takes the prompt and gets
MCP tools to hand parts of it to the other members, in parallel, and to merge what they did:

```ts
import { claude, codex, gemini, pack } from 'genaicode/agents';

const agent = pack({ lead: claude(), members: [codex(), gemini(), claude()] });
const run = agent.run({ prompt: 'Add CSV export, with tests, and have it reviewed', cwd });
for await (const event of run) {
  if (event.type === 'subtask-start') console.log(`→ ${event.agent} ${event.id}: ${event.prompt}`);
}
```

The lead decides what to delegate and to whom; genaicode adds the tools, not a loop or a router of
its own. The lead needs `capabilities.mcp` and sees these tools on an MCP server named `pack`:

| Tool       | What it does                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `agents`   | Members: installed or not, tasks running, the plan limits each reported, its last failure kind  |
| `delegate` | Starts `prompt` on a member and returns a task id at once                                       |
| `wait`     | Blocks until tasks end (or `timeoutSeconds`), then reports status, final message, changed files |
| `steer`    | More input for a running task, where the member has `steer()`                                   |
| `stop`     | Stops a running task                                                                            |
| `diff`     | A worktree task's changes as a unified diff                                                     |
| `review`   | A read-only second opinion on the full patch, attached to the worker's task                     |
| `merge`    | Applies a finished task's changes to the lead's directory (`threeWay` for conflict markers)     |
| `discard`  | Drops a finished task's changes                                                                 |

- A delegated task runs in its own git worktree under `.genaicode/worktrees/` (git-ignored): a
  copy of the files as they are, uncommitted and untracked ones included. Nothing reaches the
  working directory until the lead merges it, and a merge stages and commits nothing. Files git
  ignores (`node_modules`, build output) are not in a worktree; `prepareWorktree(dir, repo)` can
  link or install them. Mode `shared` runs a task in the lead's directory instead, for reviews and
  for directories that are not git repositories.
- Events are the lead's, plus `subtask-start`, `subtask` (a delegated task's own event; its `done`
  ends the task) and `subtask-update` (`merged` or `discarded`). A merge also emits `file-change`.
- `usage` events and `result.usage` add up the lead and every delegated task, and `task.budget`
  caps the sum. `maxParallel` (default 4) caps how many tasks run at once.
- Delegated tasks get the run's `env`, `permissions` and `onApproval`; their request ids are
  prefixed with the task id and the summary names the agent. A request to run a command that only
  reads inside the task's directory (`ls`, `cat`, `rg`, `git log`/`diff`/`status`, `sed -n '1,20p'`,
  joined by `&&` or `|`; `isReadOnlyCommand()` decides) is approved without asking, so a review
  is not stopped by its first `ls`. That holds only in a git repository (not `/` or the home
  folder), for programs from PATH or a system `bin`, without globs, and with symlinks followed. `readOnlyCommands: 'ask'` asks for those too.
- `delegate` takes an optional `cwd`, absolute or relative to the lead's, for work in another
  directory than the lead's own.
- `delegationBrief` is a short briefing for a lead that mostly works by itself: the tools are
  there for when the person asks for another agent (`genaicode ui --delegate` uses it).
- `resume`, `steer()` and `result.sessionId` are the lead's. Tasks still running when the lead
  finishes are stopped. Unmerged worktrees stay for the next turn; `agent.close()` removes them.

In a live chat, `turn.pack.tasks` holds the delegated work under its original turn.
`session.actOnPackTask?.(turn.id, id, { type: 'diff' })` returns the unified patch.
The same method accepts `merge`, `discard`, `stop` and `{ type: 'steer', text }`.
Each run also exposes these controls as `run.pack`. A chat can still review and merge
finished tasks after a later turn starts. Adopted transcripts are read-only.

Use `{ type: 'review' }` to get a fresh review from the first eligible installed agent,
starting with the lead and excluding the worker. The pack passes the complete patch as text
to `CodingAgent.runText`. Claude Code implements this with tools, MCP, hooks and project
context disabled. A custom driver can supply the same capability. Other drivers remain
eligible to do the work. `{ type: 'verify' }` runs the pack's configured
`verification: { label, run(cwd, signal, snapshotRoot) }` in a private checkout of the
recorded Git tree. The pack removes the checkout after the callback finishes. An
embedding application supplies the isolation for its own verifier. The callback returns
`{ ok, detail }`. Both results appear in `task.checks`. Each result records its
Git tree in `revision`. Compare it with `checks.revision` to spot an outdated result.
Pass the revision displayed to the operator in `{ type: 'merge', revision }` so a
concurrent edit leaves the worktree open for inspection. Set `operatorMerge: true` to
have the lead leave completed changes for the operator by default.

## Sessions across agents

Every agent keeps its conversations somewhere of its own. `listSessions()` reads those stores and
returns one list, so an app can show what is going on in every project, whichever agent did it:

```ts
import { claudeSessions, codexSessions, groupSessions, listSessions } from 'genaicode/agents';

const sources = [claudeSessions(), codexSessions()];
const { sessions, errors } = await listSessions(sources, { since: Date.now() - 7 * 86_400_000 });
for (const project of groupSessions(sessions)) {
  console.log(project.name, project.agents); // app { claude: 12, codex: 3 }
  for (const s of project.sessions) console.log(' ', s.agent, s.state, s.title ?? s.lastPrompt, s.id);
}
```

A `SessionInfo` has the agent, its session `id` (what `AgentTask.resume` takes), the directory it
started in, branch, title, first and latest prompt, the end of the latest reply, model, usage or
cost where the store has them, and a `state`: `active` (written to in the last two minutes),
`waiting` (the agent had the last word) or `unfinished` (it stops at the user's message or in the
middle of the agent's work).

Every driver says where its sessions are in `agent.sessions`: a `SessionSource`, or `null` when
it keeps none genaicode reads. `agentSessionSources(agents)` collects them (one per store, so
`codex()` and `codexLive()` count once):

```ts
const agents = [claude(), codex(), codexLive(), gemini()];
const { sessions } = await listSessions(agentSessionSources(agents), { limit: 50 });
```

### Which sessions need you: hooks

The stores say what was written, not what the agent is doing right now: a session that asks
"may I run this command?" looks the same as one that is thinking. Claude Code, Codex, Gemini
CLI, GitHub Copilot CLI and Cursor's CLI can say it themselves through their hooks:

```bash
npx genaicode hooks install        # for the agents installed here; -a claude (codex, gemini...) for one
npx genaicode hooks                # what is installed
npx genaicode hooks uninstall
```

`install` adds one command hook to the agent's own user settings (`~/.claude/settings.json`,
`~/.codex/hooks.json`, `~/.gemini/settings.json`, `~/.cursor/hooks.json`; for Copilot a file of
its own, `~/.copilot/hooks/genaicode.json`), beside whatever is declared there; Codex runs it
once you trust it under `/hooks`, Copilot from its next start. The hook runs `genaicode hook <agent>` in the background when a session starts, takes a
prompt, asks for approval, gets its answer, finishes a turn and ends. It keeps one small file
per session in `~/.genaicode/live` with the state, the time, the directory and the name of the
tool asked for: nothing of what was said, and nothing leaves the machine.

Claude Code, Codex and Copilot identify the tool in an approval request. Gemini CLI identifies
shell commands in its permission notifications and can also send a generic request for attention.
Cursor reports working sessions and finished turns. Gemini and Cursor wait for their hooks, and Gemini
shows that a hook runs unless `hooksConfig.notifications` is off.

`listSessions()` puts that over what the stores suggest: `state` is exact, and a `waiting`
session has `waitingFor`: `'approval'` (with `waitingTool`, such as `Bash`) or `'reply'`.
`genaicode sessions` marks the first with `◆`, and the browser's Sessions view has a filter for
them. A record the session's file has since moved past is ignored, so sessions driven without
the hook fall back to the stores. `{ live: false }` in the query leaves the reports out.

`genaicode sessions --waiting` (`-w`) is the inbox: only the sessions whose next move is yours,
those asking for approval first, each with the tool it asks for or the end of what it said, and
the command that continues it. It looks a week back unless `--since` says otherwise. The
browser's Sessions view has the same as a "N wait for you" button; in code,
`waitingSessions(sessions)` picks and orders them.

Not every waiting session asks for something: most just ended. `SessionInfo.ending` says what the
end of the agent's last message asks, read from its shape by `replyEnding(lastReply)`: `question`
(it ends on a question), `command` (it ends on a shell code block for you to run), `offer` ("I can
also...", "let me know") or `unreported` (it says it could not report back to the thread that sent
it). Those come right after the approvals in `--waiting`, marked `●`, and `sessions_list` says
`[ends with: question]`. It is a guess from the last 200 characters: a request put as a plain
statement is not seen.

Sessions nobody typed into are left out of every listing: scheduled tasks and notifications in
Claude Code (every prompt has `origin.kind` or `turnOrigin` other than `human`, or the session
opens with a scheduled task nobody answered), headless runs of it with a single prompt (a program
driving it through more prompts is somebody's chat), `codex exec` runs, threads the Codex desktop
app's server ran for another program, Muse Code's probes, Antigravity runs a program started
outside any project, and any agent's session in a temporary directory or in a worktree under
`.genaicode/worktrees` (unless it asks for approval right now). They carry `automated: true`;
`sessions --automated`, or `{ automated: true }` in the query, lists them too.

**Topics.** Sessions can be kept as pieces of work that cross agents and directories
([`genaicode topics`](cli.md#your-work-as-topics-topics)). An agent of your choice does the
sorting; genaicode writes the prompt, reads the answer and keeps the result:

```ts
import {
  listSessions,
  readTopics,
  sortedTopics,
  summarizeTopics,
  topicsPrompt,
  unsortedSessions,
  writeTopics,
} from 'genaicode/agents';

const { sessions } = await listSessions(sources, { since: Date.now() - 30 * 86_400_000 });
const store = await readTopics();
const todo = unsortedSessions(sessions, store).slice(0, 120);
const { text } = await agent.run({ prompt: topicsPrompt(todo, store), cwd: emptyDir }).result;
const sorted = sortedTopics(text ?? '', todo, store); // { store, placed }
await writeTopics(sorted.store);
const { topics, unsorted } = summarizeTopics(sessions, sorted.store); // asking first, then the latest
```

The prompt holds one line per session (agent, last two directory names, title or first and last
prompt), quoted as data. `renameTopic()`, `mergeTopics()` and `moveSessions()` correct a store; a
session that has a topic is never moved by a later answer. `projectTopics(sessions, store)` places
the sessions relayed from a claude.ai project (`SessionInfo.project`: its id, and its name where
the session gives it; such a session is titled as its thread there) in a topic named as the project, without an agent. What ran in a pack member's worktree
(`.genaicode/worktrees`) or a temporary directory (`inRunDirectory()`) takes no topic.

`topicShares(sessions, store)` says where each agent's work went: per agent, the part every topic
took (0 to 1), with `Automatic runs` and `Not sorted yet` as parts of their own. Sessions are
weighed by `costUsd` where the agent keeps one, else by tokens; only proportions are returned.
List the sessions with `automated: true`, or scheduled runs are missing from the picture.

For Copilot and Gemini shell approvals, `waitingCommands` contains the tool name and up to
200 characters of each matching command. Genaicode keeps a digest in its private hook record
and reads the text on demand from the agent's own local session journal. A session with a
missing journal or incomplete permission details still reports the approval. The CLI, the
browser and the opt-in `sessions_waiting` MCP tool show the preview. Desktop alerts contain
only the agent, project and tool name. The user answers these requests in the native agent.
Copilot records the decision as soon as it is made. Gemini CLI 0.70 reports the result when
the tool finishes, so a refresh can still show its last request while the command runs.

The hook is declared with the Node that installed it. When that Node goes (a version manager
removed it), the hook fails without a word; `genaicode hooks status` says `broken` then (`missing`
in `hooksStatus()`), and `genaicode hooks install` writes it again.

In code: `installHooks('claude')`, `hooksStatus()`, `uninstallHooks()`, and `recordHook(agent,
input)` with `readLive()` and `withLive(sessions, records)` to do the same for an agent of your
own whose hooks give the same JSON (`session_id`, `hook_event_name`, `cwd`); `hookInput(agent,
input)` puts Gemini's, Copilot's and Cursor's in those words.

The command in the settings is the `genaicode` that installed it (`node` and the path of its
`cli.js`): install it from a `genaicode` that stays where it is (a project's dependency or a
global install), and run `hooks install` again after moving it.

For Claude Code, `hooks install` also sets `statusLine` in the same settings to `genaicode limits
record`, which keeps the plan limits Claude Code reports for [`genaicode limits`](cli.md#how-much-of-your-plans-is-used-limits)
and prints them as the line. A status line you set yourself is never replaced; `hooksStatus()`
says which it is (`statusLine: 'genaicode' | 'other' | 'none'`).

### Sending a turn to a session

`sendSession()` accepts a user's message for the local session's own driver. It checks the
session state again at send time, resolves the original working directory and passes the full
native session id to `AgentTask.resume`. Use `onEvent` for streaming or await the final result.

```ts
import { claude, codex, sendSession } from 'genaicode/agents';

const result = await sendSession([claude(), codex()], id, message, {
  permissions: { sandbox: 'read-only' },
  onEvent(event) {
    if (event.type === 'text-delta') process.stdout.write(event.text);
  },
});
```

Pass `{ source }` with a full id from a listing to target that exact session. CLI callers can
also supply a unique id prefix. A busy session, pending approval, missing directory, unknown
state or unsupported driver prevents the run from starting. When hooks are absent, the store's
activity estimate applies. A claim under `~/.genaicode/sending` keeps concurrent tower sends
to the same session apart, including sends from separate processes. Native clients report their
own activity separately. The session MCP tools remain read-only.

### Being told: `notify`

```bash
npx genaicode notify on          # a desktop notification when a session asks for approval
npx genaicode notify on --done   # ...and when a session finishes its turn
npx genaicode notify test        # show one now
npx genaicode notify off
```

The hooks above do it, so `hooks install` comes first. The notification names the agent, the
project's directory and the tool asked for, nothing of what was said: Notification Center on macOS
(`osascript`), the desktop's notifications on Linux (`notify-send`). A question is told once,
however many hooks remind of it. The setting is kept in `~/.genaicode/notify.json`. In code:
`noticeFor(before, after, settings)` decides, `sendNotice(notice)` shows it, and `recordHook()`
takes `onRecord(before, after)` to do the same for an agent of your own.

### Answering from the tower: `hooks install --answer`

```bash
npx genaicode hooks install --answer           # Claude Code: questions can be answered from here too
npx genaicode sessions --waiting               # each question with what the tool would do
npx genaicode sessions approve 3f9a0c1d2e4b
npx genaicode sessions deny 3f9a0c1d2e4b -m "use the staging database"
```

With `--answer`, Claude Code's `PermissionRequest` gets one more hook, one Claude Code waits
for: it holds the question open for up to 9 minutes in `~/.genaicode/asks/` (readable by you only)
with the tool and a line of what it would do (the command, the file, the address). Claude Code
shows its own dialog meanwhile, as always; whichever answer comes first counts. Answered in
Claude Code, the hook sees the tool run (or Claude Code ends it) and lets go; nothing answered,
it lets go after 9 minutes and the dialog stays. The browser's Sessions view shows the same
questions under their session with Approve and Deny. A denial tells the agent why, if you say.

Codex is left out: it shows its prompt only after the hook is done, so a hook that waits would
hold it back. No MCP tool answers questions: an agent cannot approve another agent's tool. In
code: `pendingAsks()`, `answerAsk(id, { behavior: 'allow' })`, and `waitForAnswer(agent, input)`
for a hook of your own.

### Putting sessions away: `sessions archive`

```bash
npx genaicode sessions archive --stale            # every one waiting or left half way for 2 days or more
npx genaicode sessions archive --stale --older 5d -a codex
npx genaicode sessions archive 9f6a3318           # these ones
npx genaicode sessions unarchive 9f6a3318
npx genaicode sessions --archived                 # list them too
```

Archiving hides a session from `sessions`, `--waiting` and the browser's Sessions view (which has
Archive and Unarchive on each row, "Archive N stale", and an Archived filter). The agents' own
files are not touched: genaicode notes the session and when in `~/.genaicode/archived.json`, and a
session with any news after that (a prompt, a hook's report) is back by itself. A session an agent
works in, or one in the cloud, is never stale. In code: `listSessions()` marks archived sessions
`archived: true` and `waitingSessions()` leaves them out; `archiveSessions(sessions, archived)`,
`staleSessions(sessions, olderThanMs)` and `readArchive()`.

### When an agent changes its store: `sessions doctor`

No agent promises how it keeps its sessions, so an update of its CLI can change the store, and a
reader that no longer understands it goes quiet instead of failing. `sessions doctor` shows it:

```bash
npx genaicode sessions doctor            # every store; exits 1 when one looks broken
npx genaicode sessions doctor -a codex --since 7d --json
```

```
claude  2.1.340 (checked with 2.1.327)  ok
  412 sessions: 398 with a prompt or title, 412 with a directory, 412 with a state
  read 5 of the 5 newest: agent messages in 5, tool calls in 4
  hooks: installed, 3 sessions reported
```

Per store it counts the sessions of the last 30 days and how many have a prompt, a directory and
a state, opens the five newest conversations, and compares the installed CLI with the version the
reader was last checked against (`SessionSource.verified`). A store where most sessions lost their
prompt or directory, or whose conversations no longer open, is a problem; a newer CLI alone is
not. It prints counts only, never what was said, so the output is safe to paste into an issue.
From code: `checkSessions(sources, { version })` returns the same as `SessionCheck[]`.

Codex can also be asked instead of read. Its app server (`codex app-server`) lists threads and
their turns in a documented protocol (`thread/list`, `thread/turns/list`), which holds across
Codex versions where the files may not:

```bash
npx genaicode sessions doctor --api                      # compare what was read with what Codex lists
GENAICODE_CODEX_SESSIONS=app-server npx genaicode sessions   # list and read through Codex itself
```

```ts
codexSessions({ via: 'app-server' }); // or 'auto': the app server when `codex` is installed
```

The files stay the default: reading them changes nothing and starts nothing, while every question
to the app server starts a Codex process (about half a second) that keeps its own state and logs
in Codex's home. When the app server cannot be asked, the files are read. `doctor --api` is the
cheap middle: the files day to day, and Codex's own answer as the reference when you check.

The repository also checks every Monday, with no keys, whether the agents' latest releases still
match the readers (`.github/workflows/drift-canary.yaml`, `node scripts/drift-canary.mjs` after a
build): it lists each published CLI version beside `verified`, and fails when the latest Codex
app-server protocol (`codex app-server generate-ts`) no longer has a field that genaicode reads.

### Asking an agent about the sessions: `sessions mcp`

The session index provides four read-only MCP tools (and, in a chat, `sessions_send`, below). In `genaicode chat --sessions`, ask
"Which sessions need my attention?" to see which project needs a decision or a reply.

| tool                | what it returns                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `sessions_projects` | projects worked in lately, with counts per agent and per state                                |
| `sessions_list`     | sessions, newest first; filters `project`, `agent`, `state`, `text`, `days`, `limit`          |
| `sessions_waiting`  | approvals and replies with open questions, filtered by `project`, `agent`, `days` and `limit` |
| `sessions_read`     | what was said in one session: prompts, the agent's messages and the names of its tools        |

```bash
npx genaicode chat --sessions                              # the chat's agent gets the tools
claude mcp add sessions -- npx genaicode sessions mcp      # or any agent, as a stdio MCP server
codex mcp add sessions -- npx genaicode sessions mcp
```

`sessions_waiting` uses the same order as `genaicode sessions --waiting`. It shows approvals
first, then sessions awaiting a reply, newest first within each group. It looks back seven days
and shows up to 30 sessions by default. For questions held open by `hooks install --answer`,
the agent can read the question ID, tool name and preview. Archived sessions stay out of this
view and appear with `[archived]` in `sessions_list` and `sessions_read`.

The [session tower](cli.md#open-the-session-tower) opens an indexed chat with a local preview
of the queue. Its `/waiting [project]` and `/read <id>` commands call the same read-only
operations and display the results to the user. A regular chat message starts an agent turn.

In `chat --sessions` and `ui --sessions` (the desktop app) the agent also gets `sessions_send`:
ask it "tell Codex in knights that the bakery is done" and it finds the session and sends the
message there as a new turn, with that session's own agent in its own directory. The first
message to each session shows as an approval in the chat, with the recipient and the exact
text; once allowed, later messages to that session go without asking until the chat closes.
With auto-approve on (`--yes`, `/auto`) nothing is asked. The tool returns once the message is
sent, and the chat shows the session's answer when its turn ends. A session that is working right
now (or waits for an approval) gets the message queued: the tool answers "Queued for ...", the
chat says so, and the message goes as that session's next turn once the current one ends. Several
messages to one session go in order, one turn each. A queued message is dropped when the chat
closes first or the session still works after 6 hours (`maxWaitMs`). The agent in the other
session is not interrupted: its CLI offers no way in from outside mid-turn. Closing the chat
stops a turn still running there. In code: `sessionSendTool(agents, gate)` with a `SessionSendGate` the chat
attaches to, and `AgentSession.ask()` for the question.

When the tower runs a pack, its lead also receives `propose_session_message` on the pack MCP
server. It takes the full session `id`, the exact `text` and an optional `source`. A successful
call queues a draft in the operator's inbox. The operator can dismiss it or send it once,
using the target agent's own driver in the reviewed directory. The tower checks the target
again before resuming it. A closed tower forgets its drafts.

`state` is `active`, `waiting`, `unfinished` or `approval` (a session that asks whether it may use
a tool, known once the [hooks](#which-sessions-need-you-hooks) are installed). The tools only read
the local stores. They are off unless you ask for them, because the agent that has them reads what
your other agents' sessions said, and that text goes to its model like anything else it reads;
treat what it finds there as content, not as instructions. `sessions mcp -a codex` serves one
agent's sessions only. The server also tells the agent when to use the tools (MCP `instructions`,
`SESSION_TOOLS_INSTRUCTIONS`), so "which sessions are open?" goes to the index and not to the
agent's own session list; pass `instructions` to `startLocalMcpServer()` for the same in code.

```ts
import { agentSessionSources, claude, codex, sessionTools, startLocalMcpServer } from 'genaicode/agents';

const index = await startLocalMcpServer({
  name: 'sessions',
  tools: sessionTools(agentSessionSources([claude(), codex()])),
});
agent.run({ prompt: 'What waits for me?', cwd, mcpServers: [index.mcpServer] });
```

### Continuing a session in another agent

Sources whose conversations can be read have `read(session)`: the turns of a session (prompts, the
agent's messages, tool calls with their output), as `createAgentSession` keeps them. Every local store genaicode
lists has it except Cursor's (Gemini CLI and newer Copilot CLI keep what was said, without tool calls). `session.adopt(turns)` takes them over: they join the transcript, and the
next prompt hands them to the current agent like `/agent` does, a recap in the prompt and the
whole transcript in `.genaicode/handoff/`.

```ts
const sources = agentSessionSources([claude(), codex()]);
const found = await findSession(sources, 'a1b2c3d4'); // an id, or the start of one
if (found) {
  const session = createAgentSession({ agent: codex(), cwd: found.session.cwd! });
  session.adopt(await readSession(sources, found.session));
  session.send('Finish what Claude started.');
}
```

`adopt(turns, { sessionId })` is for the agent's own session: the next prompt resumes it, and the
turns are there to show. Only the end of a very long transcript is read (the last 8 MB, 100 turns).

| Driver               | Source                  | Reads                                                                                  |
| -------------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| `claude`             | `claudeSessions()`      | `~/.claude/projects/*/*.jsonl` (`CLAUDE_CONFIG_DIR`), without subagents                |
| `codex`, `codexLive` | `codexSessions()`       | the thread index `~/.codex/state_<n>.sqlite` (`CODEX_HOME`), else rollout files        |
| `copilot`            | `copilotSessions()`     | `~/.copilot/session-state/<id>/workspace.yaml`, `events.jsonl` (or `session-store.db`) |
| `cursor`             | `cursorSessions()`      | `~/.cursor/chats/<hash>/<id>/meta.json`, the model from the chat's `store.db`          |
| `gemini`             | `geminiSessions()`      | `~/.gemini/tmp/<project>/chats/session-*.jsonl`                                        |
| `antigravity`        | `antigravitySessions()` | `conversation_summaries.db` in `~/.gemini/antigravity` and `antigravity-cli`           |
| `muse`, `museLive`   | `museSessions()`        | `~/.local/share/muse/session-index.db`                                                 |
| `vibe`               | `vibeSessions()`        | `~/.vibe/logs/session/*/meta.json` (`VIBE_HOME`), with token and cost totals           |
| `opencode`           | `null`                  | not read yet                                                                           |
| `anthropicManaged`   | cloud                   | `GET /v1/sessions` of the driver's agent: title, status, model, usage, cost            |
| `cursorCloud`        | cloud                   | `GET /v1/agents`: the account's agents that are not archived, with their links         |
| `geminiManaged`      | `null`                  | the Interactions API lists nothing                                                     |
| `openaiManaged`      | `null`                  | the Responses API lists nothing                                                        |

What a store does not keep stays undefined: Cursor has no usage, Antigravity and Vibe no model,
and stores listed from an index without opening transcripts (Muse, Antigravity) give no latest
reply. Codex, Muse, Antigravity, Cursor and Copilot's `session-store.db` fallback read SQLite
files with `node:sqlite` (Node 22.5 or newer; on an older Node Codex, Muse and Antigravity land
in `errors`, Cursor skips the model and Copilot needs `events.jsonl`). Subagent sessions and
archived threads are left out.

A hosted driver lists what its platform lists, with `where: 'cloud'` and, where there is one, a
`url` to open the session: pass `anthropicManaged(...)` or `cursorCloud()` to
`agentSessionSources` next to the local agents. A cloud session has no local directory, so a
query with `cwd` leaves the clouds out.

Reading is read-only. Transcripts are read at their start and end only, so a store with hundreds
of long sessions lists quickly. `query` takes `since`, `cwd` and `limit`. A source that cannot be
read lands in `errors` and the others are still listed. A `SessionSource` is `{ name, where,
list(query) }`: implement one for another agent or for a vendor's cloud and pass it in the list.
`genaicode sessions` prints the same from the command line (see [cli.md](./cli.md)).

## Follow-up turns

`result.sessionId` names the agent's own session. Pass it as `resume` to continue that
session with a new prompt; the agent keeps the earlier turns as context:

```ts
const agent = claude();
const first = await agent.run({ prompt: 'Add a --dry-run flag', cwd }).result;
const next = await agent.run({ prompt: 'Now cover it with a test', cwd, resume: first.sessionId }).result;
```

`claude`, `codex`, `codexLive`, `cursor`, `opencode`, `copilot`, `antigravity` and `museLive` support it (`capabilities.resume`).
`codexLive` resumes the stored thread with its saved sandbox and approval policy unless the caller overrides them.
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

| Driver                | Command        | Mode                                     | Notes                                                                                                           |
| --------------------- | -------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `claude(options?)`    | `claude`       | `-p --output-format stream-json`         | inherits user `permissions.defaultMode` (fallback `acceptEdits`); `allowedTools` / `disallowedTools`; approvals |
| `codex(options?)`     | `codex`        | `exec --json`                            | `sandbox` defaults to `workspace-write`; effort via `model_reasoning_effort`                                    |
| `muse(options?)`      | `muse`         | `exec --json --trust-workspace`          | `maxTurns` maps to `--max-model-steps`                                                                          |
| `codexLive(options?)` | `codex`        | `app-server` (JSON-RPC)                  | `steer()`, approvals, MCP. See [Live sessions](#live-sessions-steering-and-approvals)                           |
| `museLive(options?)`  | `muse`         | `serve` (JSON-RPC)                       | `steer()`, approvals. See [Live sessions](#live-sessions-steering-and-approvals)                                |
| `gemini(options?)`    | `gemini`       | `--output-format stream-json --prompt=…` | `approvalMode` defaults to `auto_edit`; `--skip-trust` unless `trustWorkspace: false`                           |
| `cursor(options?)`    | `cursor-agent` | `-p --output-format stream-json`         | `--force --approve-mcps` by default (`--trust` if `force: false`); `partialOutput`                              |
| `opencode(options?)`  | `opencode`     | `run --format json`                      | `model` is `provider/model`; `effort` maps to `--variant`; `autoApprove` adds `--auto`                          |
| `copilot(options?)`   | `copilot`      | `--output-format json --prompt=…`        | `--allow-all-tools --no-ask-user` by default; `allowTools` / `denyTools` patterns                               |
| `vibe(options?)`      | `vibe`         | `--output streaming --prompt=…`          | `agent` defaults to `accept-edits`; `--trust`; `model` via `VIBE_ACTIVE_MODEL`                                  |
| `antigravity(opts?)`  | `agy`          | `acp` (JSON-RPC)                         | `steer()`, approvals, MCP, resume; `mode` defaults to `accept-edits`; `--sandbox`                               |

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
  permission mode still applies first (the user's `permissions.defaultMode` when set, else
  `acceptEdits`): only what it does not allow is asked. Approving allows exactly the input Claude asked about (`updatedInput` unchanged).
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

### Managed agent platforms

Platforms such as Anthropic Managed Agents, Gemini Managed Agents, OpenAI and Cursor Cloud
Agents keep sessions that outlive the process that started them, report usage, enforce their
own budgets and some ask for approvals. Implement `ManagedProvider` for those. Every method
takes a session id, so a server can start a session, store `snapshot.id`, and read it with
`get()` after a restart:

```ts
import { managedAgent, type ManagedProvider } from 'genaicode/agents';

const provider: ManagedProvider = {
  name: 'my-platform',
  capabilities: { mcp: true, resume: true, usage: true, budget: ['usd'] },
  start: (request, signal) => api.createSession(request, { signal }), // -> ManagedSnapshot
  get: (id, signal) => api.getSession(id, { signal }), // { id, state, stopReason?, usage?, costUsd?, ... }
  watch: (id, signal) => api.streamSession(id, { signal }), // optional: AsyncIterable<{ events?, snapshot? }>
  send: (id, text) => api.message(id, text),
  answer: (id, approvalId, decision) => api.confirm(id, approvalId, decision),
  interrupt: (id) => api.interrupt(id),
  release: (snapshot) => api.archiveVaults(snapshot.release), // per-session credentials, uploads
};

const run = managedAgent(provider).run({ prompt, cwd: 'env_123', budget: { maxCostUsd: 2 } });
```

`managedAgent()` turns it into a `CodingAgent`: it follows `watch()` when the provider has one
and polls `get()` (and `events()`) otherwise. A turn ends when the session is `idle` with any
stop reason other than `requires-action`, or when it ends. `approval-request` events are
answered through `task.onApproval` and `answer()`, under `task.permissions.approval`.
`task.budget` goes to the platform as well as to the usual budget check, and a session the
platform stopped at its cap (`stopReason: 'budget'`) fails with `failure.kind: 'budget'`.
`timeoutMs` becomes `maxDurationSeconds`. Only remote MCP servers are accepted, and their
`headers` must never appear in snapshots or events. `release()` runs after every run; the
session itself stays for `task.resume` unless `managedAgent(provider, { deleteSession: true })`.
A resumed run reports its own share: usage and cost are the change since it began, and the
budget sent to the platform adds what the session had already spent. Provider exceptions are
classified for `withFallback()`: an explicit `error.failure`, HTTP 401/403 (`auth`), 429
(`quota`), 5xx or a network error (`unavailable`). Paged `events()` set `hasMore` to be read
before the next interval, and `watch()` gets the last update's `cursor` when it reconnects.
The snapshot `start()` returns may carry a `cursor` just before the new turn's first event;
reading starts there, so a resumed session's history (and its approvals) is not replayed.

`hostedAgent()` is `managedAgent(fromHosted(provider))`.

#### Claude Managed Agents

`anthropicManaged()` runs tasks as sessions of an agent you created once on
[Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview), in one of
your environments. It calls `@anthropic-ai/sdk`'s `beta.sessions`; pass a client from a version
that has them (genaicode's own SDK dependency may be older):

```ts
import Anthropic from '@anthropic-ai/sdk';
import { anthropicManaged } from 'genaicode/agents';

const agent = anthropicManaged({
  client: new Anthropic(),
  agent: 'agent_011...', // or { id, version } to pin one
  environment: 'env_011...',
  githubToken: () => process.env.GITHUB_TOKEN!, // for https://github.com/... workspaces
  tools: { run_tests: async ({ path }) => runTests(String(path)) }, // the agent's custom tools
});

const run = agent.run({
  prompt: 'Fix the failing test',
  cwd: 'https://github.com/acme/game#main', // cloned into the session; other cwd values are ignored
  budget: { maxCostUsd: 5 }, // the session's own list-cost cap
  mcpServers: [{ name: 'game', url: 'https://example.com/mcp', headers: { Authorization: `Bearer ${token}` } }],
});
```

- The prompt starts the session; `steer()` adds a `user.message`, `abort()` sends `user.interrupt`.
  `task.resume` (a session id) sends the next message to the same session.
- Tool calls the agent's permission policy pauses (`always_ask`, or `auto` without a verdict) come
  back as `approval-request` and are answered with `user.tool_confirmation`.
- `model`, `effort` and `system` (added to the agent's prompt) override the agent for that
  session only. MCP servers the agent does not have are added for the session; a bearer token
  goes into a vault made for the session, which `release()` deletes after the run, so a resumed
  session cannot take new MCP credentials. Only `Authorization: Bearer` headers can be vaulted.
- `ManagedStart.files` are uploaded and mounted under `filesRoot` (default `/workspace`).
- Usage and list cost come from the session; an `idle` at `budget_reached` fails with
  `failure.kind: 'budget'`, rate-limit and billing errors with `quota`, overload with `unavailable`.
- `maxTurns` and `extraArgs` are refused; `permissions.sandbox` is the environment's business.

#### Gemini Managed Agents

`geminiManaged()` runs tasks on
[Gemini Managed Agents](https://ai.google.dev/gemini-api/docs/agents) (the Antigravity agent) through
the Interactions API, with plain `fetch`. It reads `GEMINI_API_KEY` by default; `agentPlatform`
switches to Gemini Enterprise Agent Platform on Google Cloud with an OAuth access token:

```ts
import { geminiManaged } from 'genaicode/agents';

const agent = geminiManaged({
  // agent: 'agents/my-agent', // a saved agent; default antigravity-preview-09-2026
  // agentPlatform: { project: 'my-project', accessToken: () => getAccessToken() },
  network: ['pypi.org', 'registry.npmjs.org'], // a fresh sandbox's allowlist (MCP hosts are added)
});

const run = agent.run({
  prompt: 'Fix the failing test',
  cwd: 'https://github.com/acme/game', // cloned into /workspace/game; env_... reuses an environment
  model: 'gemini-4-carbon',
  budget: { maxTokens: 200_000 }, // the interaction's own max_total_tokens
  mcpServers: [{ name: 'game', url: 'https://example.com/mcp', headers: { Authorization: `Bearer ${token}` } }],
});
```

- Each turn is a background interaction; `abort()` cancels it. `task.resume` (the last run's
  `sessionId`) chains a new interaction to it in the same environment, so the next run's
  `sessionId` is a new id. Usage adds up the whole chain, and a resumed run reports its own share.
- Steps stream live (text, MCP, code execution and search calls with their results) and the
  stream picks up from the last event after a drop.
- MCP servers replace the agent's default tools for that turn, so `tools` (default code execution,
  Google Search, URL context) is sent beside them. Server names must match `^[a-z0-9_-]+$`.
- `ManagedStart.files` (text only) and the repository go into a fresh sandbox under `filesRoot`
  (default `/workspace`); they cannot be added to an existing environment or on resume.
- `incomplete` (the token cap) fails with `failure.kind: 'budget'`; a failed interaction's error
  code maps `RESOURCE_EXHAUSTED` to `quota`. The agent asks no approvals (`permissions.approval`
  is `auto-approve` only); `effort`, `maxTurns` and `extraArgs` are refused, and so is `model` for
  a saved agent, whose `agent_config` is fixed: its runs have no platform token cap
  (`capabilities.budget` is empty), so `task.budget` is checked against reported usage only.

#### OpenAI background responses

`openaiManaged()` runs tasks as background responses of the
[Responses API](https://developers.openai.com/api/docs/guides/background), with OpenAI's hosted
tools doing the work: by default a hosted shell and web search. It
reads `OPENAI_API_KEY` by default:

```ts
import { openaiManaged } from 'genaicode/agents';

const agent = openaiManaged({
  model: 'gpt-6.2-astra',
  network: ['pypi.org', 'github.com'], // the session container's allowlist (none by default)
  // tools: [{ type: 'code_interpreter', container: { type: 'auto' } }], // instead of the defaults
});

const run = agent.run({
  prompt: 'Clone the repo, run its tests and summarize the failures',
  cwd: '.', // or cntr_... to reuse a container you created
  effort: 'high', // reasoning.effort
  maxTurns: 40, // max_tool_calls
  mcpServers: [{ name: 'game', url: 'https://example.com/mcp', headers: { Authorization: `Bearer ${token}` } }],
});
```

- The response is polled (`pollIntervalMs`, default 3 s): each output item arrives as a whole
  event once it is finished (messages, MCP, shell, code interpreter and web search calls), so
  there are no `text-delta` events. `abort()` cancels the response.
- `task.resume` (the last run's `sessionId`) chains a new response with `previous_response_id`,
  so the next run's `sessionId` is a new id. Usage adds up the whole chain, and a resumed run
  reports its own share.
- The default shell runs in a container made for the session (or the `cntr_...` workspace), and
  a resumed run goes on in the same one, files included. It expires `containerMinutes` (default 20) after its last use; resuming after that fails rather than starting from an empty disk.
- MCP servers run without approvals (`require_approval: 'never'`; `permissions.approval` is
  `auto-approve` only). Their only header can be `Authorization: Bearer`, which the platform takes
  as `authorization`: it drops other headers on tool calls.
- The platform has no session-wide cap, so `task.budget` is checked against reported usage.
  A response cut at `max_output_tokens` fails with `failure.kind: 'budget'`, one cut by a content
  filter fails with its reason, and a failed response's error code maps rate limits to `quota`.
- `files` and `extraArgs` are refused; a model is required (`model` option or `task.model`).

#### Cursor Cloud Agents

`cursorCloud()` runs tasks as [Cursor Cloud Agents](https://cursor.com/docs/cloud-agent/api/endpoints)
in Cursor's VMs, working on a repository and pushing a branch (or opening a pull request). It
reads `CURSOR_API_KEY` by default:

```ts
import { cursorCloud } from 'genaicode/agents';

const agent = cursorCloud({
  model: 'composer-2', // an id from GET /v1/models; default: the account's default model
  autoCreatePR: true,
  // env: { type: 'pool', name: 'sandbox' }, // your own workers instead of Cursor's VMs
});

const run = agent.run({
  prompt: 'Add a health check endpoint with a test',
  cwd: 'https://github.com/acme/api#main', // a repo (#branch or #sha to start from) or a PR URL
  mcpServers: [{ name: 'docs', url: 'https://example.com/mcp', headers: { Authorization: `Bearer ${token}` } }],
});
```

- A session is the agent (`bc-...`), and its `sessionId` stays the same across turns: every turn
  is a run on it. `task.resume` sends a follow-up run, which keeps the agent's model and
  repository (a different `model` or repository URL is refused). Usage is the agent's total, and
  a resumed run reports its own share.
- The run's events stream live (`text-delta`, messages, tool calls) and the stream resumes from
  the last event after a drop. Past the stream's retention the final state is read instead.
- `steer()` reaches the running turn (`delivery: 'steer'`), `abort()` cancels the run. A steer
  the platform queues as the next follow-up keeps the turn going into the run it starts.
- On resume, `mcpServers` replaces the agent's servers (an empty list drops them); left out, the
  agent keeps its current ones.
- MCP servers go along with their headers. Tools run without approvals (`permissions.approval`
  is `auto-approve` only), and there is no platform budget: `task.budget` is checked against
  usage, which is read every `pollIntervalMs` while the stream runs, and a run over it is
  cancelled.
- A local `cwd` is ignored (the agent works in its own VM). `effort`, `maxTurns`, `files` and
  `extraArgs` are refused; a system prompt goes before the task text. `vendor` fields go into
  the create (or follow-up) request as they are.

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
4. More CLIs (gemini, cursor, opencode) and a hosted coding-agent seam (`hostedAgent`, `managedAgent`). Done.
5. A Copilot CLI driver (`copilot`). Done.
6. `pack()`: a lead agent delegates to installed agents. The terminal and browser chat expose it with `--pack`.
