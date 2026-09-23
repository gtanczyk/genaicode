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
you. Stopping iteration early discards the rest; `result` still settles.

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

## Drivers

| Driver             | Command  | Mode                             | Notes                                                                          |
| ------------------ | -------- | -------------------------------- | ------------------------------------------------------------------------------ |
| `claude(options?)` | `claude` | `-p --output-format stream-json` | `permissionMode` defaults to `acceptEdits`; `allowedTools` / `disallowedTools` |
| `codex(options?)`  | `codex`  | `exec --json`                    | `sandbox` defaults to `workspace-write`; effort via `model_reasoning_effort`   |
| `muse(options?)`   | `muse`   | `exec --json --trust-workspace`  | `maxTurns` maps to `--max-model-steps`                                         |

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
- `onApproval` is asked for each permission request. It gets a `command`, `file-change` or
  `other` request and returns `'approve'` or `'deny'`. If `onApproval` is missing or throws, the
  request is denied. Codex runs with approval policy `never` when no `onApproval` is set.
- `museLive()` reports approval requests as events but always denies them
  (`capabilities.approvals` is false).
- The task ends when the agent reports its turn complete. The server is then stopped. An exit
  before that point is a failure, even with exit code 0.

For other JSON-RPC agents, `liveAgent({ name, command, args, drive })` provides the process,
an `RpcPeer`, event emission, the approval flow, and `setSteer()`. `drive(session)` runs the
protocol and resolves with `{ ok, error? }` when the turn ends.

## Discovery

```ts
import { claude, codex, muse, detectAgents } from 'genaicode/agents';

detectAgents([claude(), codex(), muse()]);
// [{ agent, path: '/usr/local/bin/claude' }, { agent, path: null }, ...]
```

Discovery checks only that the executable is present. Whether the agent is logged in, or
supports a given flag, shows up when the run fails.

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
3. MCP server injection per driver, an env scrub helper, and an opt-in verify/repair helper.
4. More CLIs (gemini, copilot, cursor, opencode) and hosted coding-agent services.
