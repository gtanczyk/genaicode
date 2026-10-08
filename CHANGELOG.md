# Changelog

## 2.13.0 — 2026-10-08

### Added

- `task.permissions`: `{ approval: 'ask' | 'auto-approve' | 'deny', sandbox: 'workspace-write' |
'read-only' | 'unrestricted' }`, or the `'yolo'` preset (auto-approve, unrestricted). Each
  driver translates it into the agent's own options and declares what it accepts in
  `capabilities.permissions`; an unsupported value or combination fails the run with an error
  instead of starting it in another mode. The sandbox bounds approvals, and `auto-approve`
  grants exactly the scope the agent asked for. Prompts decided by the policy keep their
  `approval-request` / `approval-resolved` events, marked `automatic: true`, and show as
  "Auto-approved" in `createAgentSession`, `<AgentChat>` and `genaicode chat`.
- For apps with their own argument lists: `applyPermissionArgs`, the per-agent
  `*PermissionFlags` functions, `codexThreadPolicy`, `decideApproval`, `claudeSandboxRefuses`
  and a `sandbox` option for `claudeApprovalTool`.

- `claude()` answers permission prompts: with `task.onApproval`, it serves Claude Code's
  `--permission-prompt-tool` from a private loopback MCP endpoint (random port and bearer
  token) next to the task's own `mcpServers`, and raises `MCP_TOOL_TIMEOUT` so Claude waits
  for a person. The permission mode (`acceptEdits` by default) still applies first. Approving
  allows exactly the input Claude asked about; `capabilities.approvals` is now true.
- `codexLive()` answers Codex permission profile requests (`item/permissions/requestApproval`):
  approving grants the requested categories for the current turn, denying grants none.
- `ApprovalRequest.scope`: `once` (also when absent) or `turn`, what approving grants.
- `onApproval(request, signal)`: `signal` aborts when the request is withdrawn, the turn ends,
  the process exits or the task is stopped, so an app can close the question. Late answers,
  like errors and a missing handler, deny. `createAgentSession` drops withdrawn requests from
  `approvals`; `<AgentChat>` and `genaicode chat` label turn-scoped approvals.
- The vendor protocols for apps with their own driver or MCP server: `codexApprovals`,
  `museApprovals` (for a `LiveSession`), `claudeApprovalTool`, `claudeApprovalArgs`,
  `claudeApprovalEnv`, `claudeApprovalRequest` and `startClaudeApprovalServer`.
- `LiveSession.signal`, `LiveSession.approve(request, signal?)`, the request context
  (`id`, `signal`) passed to `onRequest` handlers, `RpcPeer.cancel(id)`, and a `prepare`
  for `cliAgent` that can be async and gets a `PrepareContext` (`emit`, `signal`).

### Fixed

- `codexLive()` rejects approval requests from another thread or turn, and declines an answer
  given after the turn ended or after the server withdrew the request.
- `museLive()` no longer falls back to an approve-for-session choice when Muse offers no
  one-time approval; it denies instead. Requests of another session or turn are ignored, and an
  approval resolved elsewhere (`approval/resolved`, `alreadyTerminal`) closes its question.

## 2.11.0 — 2026-10-06

### Added

- `genaicode/react`: `<AgentChat>`, the `genaicode ui` chat as a presentational React
  component for apps that run their own `createAgentSession` and stream its `SessionState`
  to the page. It renders turns, streaming Markdown (no raw HTML; links open in a new tab),
  collapsible tool calls, edited files, errors, approvals, queued prompts and the busy
  state, and reports `onSend`, `onStop` and `onApprove`. Slots for host content:
  `renderPrompt`, `renderAfterTurn`, `renderFooter`, `notices`, `header`, `headerExtras`,
  `emptyState`, `formatToolName`. Themed with `--gc-*` CSS custom properties; styles in
  `genaicode/react/styles.css`. React (18+) comes from the app and is not a declared
  dependency. `Markdown` and the display helpers are exported too.
- `genaicode ui` and the `genaicode/vite` panel are now drawn by `<AgentChat>`.
- `genaicode/ui`: `startEmbeddedWeb` for hosts that frame the whole `genaicode ui` page,
  typed with `task` (`mcpServers`, `timeoutMs`...), `env`, `transformPrompt` and
  `frameAncestors`. The UI bundle loads only when it is called.
- `createAgentSession({ transformPrompt })` rewrites each prompt (and steered input) before
  it reaches the agent; the transcript keeps the text given to `send()`.

- The `genaicode/vite` panel can be resized: drag its left or top edge (or focus an edge and use
  the arrow keys), double-click an edge to reset it. The size is remembered across reloads.

## 2.9.1 — 2026-09-29

### Fixed

- `vite` is no longer declared as an optional peer dependency. `genaicode/vite` imports only
  its types, and the declaration made npm keep `vite` (with rollup and postcss) in
  `npm ci --omit=dev` installs of projects that have `vite` as a dev dependency.

## 2.9.0 — 2026-09-29

### Added

- The wolf from genaicode 1.0 is back in `genaicode chat` and `genaicode ui`. The browser UI
  shows it as the favicon, in the header and on the start screen. With the tab in the
  background, it barks (the original `wolf-bark.mp3`) when the agent asks for approval or
  finishes, and counts those in the tab title. The terminal UI rings the bell instead.
  `/bark [on|off]` or the Bark button toggles it.
- `genaicode/vite`, a Vite dev plugin: the `genaicode ui` chat in a panel inside the app,
  opened from the wolf in its corner, with the agent working in the project root. The page's
  errors (build errors, uncaught exceptions, unhandled rejections, `console.error`) are counted on the wolf, and
  "Fix N errors" sends them to the agent. `vite` is an optional peer dependency.
- The `genaicode ui` page sends `Content-Security-Policy: frame-ancestors 'none'`, so other
  pages cannot frame it (the Vite plugin allows its own origins).

## 2.8.0 — 2026-09-29

### Added

- `AgentTask.resume` continues an earlier agent session: pass the `sessionId` of a previous
  result, and the agent picks up its own history of that session. Supported by `claude`,
  `codex` (`exec resume`), `cursor`, `opencode` and `copilot` (`capabilities.resume`).
  Other drivers fail the task before spawning. `genaicode run --resume <id>` does the same
  from the command line.
- `createAgentSession` (`genaicode/agents`): a multi-turn conversation with an agent for chat
  front ends. It keeps a structured transcript per turn, resumes the agent session on each
  new prompt, steers or queues prompts sent mid-turn, and holds approvals until answered.
- `genaicode chat` (and plain `genaicode` in a terminal): chat with an agent in the terminal.
  `genaicode ui`: the same chat in the browser, on 127.0.0.1 behind a one-time token.
  Both are bundled into `dist/ui` and load only for those commands.

### Changed

- The opencode driver emits `tool-start` (with the tool's input) before each `tool-end`.
- `genaicode` with no arguments opens the chat in a terminal; it prints help otherwise.

## 2.7.0 — 2026-09-29

### Added

- The Anthropic provider maps `thinking.level` to `output_config.effort` (`minimal` and
  `low` → `low`, `medium`, `high`) with adaptive thinking on models that have it (Opus and
  Sonnet 4.6 and later, Fable, Mythos). Before, `level` was ignored on Anthropic.
- `anthropicModelTraits(model)` reports what a Claude model ID accepts (adaptive thinking,
  budgets, temperature, forced tool choice, how thinking turns off). It reads Bedrock
  (`anthropic.`) and Vertex (`@date`) IDs too.

### Fixed

- Claude Sonnet 5.5, Opus 5.5 and Fable 5.1 no longer 400 on requests genaicode builds:
  - `thinking: false` sends `between_tools` on Sonnet 5.5, and on Opus 5.5 / Fable / Mythos
    (where thinking cannot be turned off) leaves `thinking` out and sets effort `low`.
  - A forced `toolChoice` (`'required'` or `{ name }`) becomes `auto` plus a system-prompt
    line asking for the call. These models reject `any` / `tool`; check that a call was made.
- `thinking.budgetTokens` becomes adaptive thinking on models that removed budgets (Opus
  4.7+, Sonnet 5+, Fable, Mythos) instead of a 400.
- `temperature` is left out on models that reject it (Opus 4.7+, Sonnet 5+, Fable, Mythos),
  as for `gpt-6-luna`.

## 2.6.0 — 2026-09-28

### Added

- `npx genaicode` is a command-line front end to the `genaicode/agents` drivers.
  `genaicode agents` lists which agent CLIs are installed, and `genaicode run <prompt>`
  runs one task with the first installed agent (or `--agent <name>`), with `--cwd`,
  `--model`, `--effort`, `--max-turns`, `--timeout`, `--json` event output, and a
  `--verify <command>` repair loop. It replaces the 2.x notice the bin used to print;
  `npx genaicode@1` still runs the legacy 1.x agent.

### Fixed

- `museLive()` reads tool items as `muse serve` sends them (`itemId`, `tool`), so
  `tool-start`/`tool-end` carry the item id and the tool name (`bash`) instead of `toolCall`.
- `muse()` no longer reports Muse's internal reminder subagents (`reminder.child_run`) as
  tool calls, and names tools without the `tool:` prefix (`bash`, like `museLive()`).

## 2.5.3 — 2026-09-26

### Fixed

- The OpenAI provider leaves out `temperature` for `gpt-6-luna` models, which reject any
  value but their default. Before, `.temperature(0)` on Luna failed with a 400.

## 2.5.2 — 2026-09-24

### Fixed

- `museLive()` now answers approvals: `onApproval` decides each request (and each stage of a
  multi-stage one) through Muse's `approval/decide`. Before, requests were refused
  unanswered and stayed pending.

### Notes

- 2.5.1 was never published; this fix shipped as 2.5.2.

## 2.5.0 — 2026-09-24

### Added

- Drivers `vibe()` for Mistral Vibe (`--output streaming`) and `antigravity()` for the
  Antigravity CLI (`agy --output-format stream-json`).

### Changed

- `codex()`: a failed MCP tool call's `tool-end` event carries the error message as `output`.

### Notes

- 2.4.2 was published from the same code.

## 2.4.1 — 2026-09-24

### Notes

- Releases are published from GitHub Actions when a version tag is pushed. See
  [docs/releasing.md](docs/releasing.md).

## 2.4.0 — 2026-09-24

### Added

- `genaicode/agents` subpath (experimental): run installed coding-agent CLIs behind one
  `CodingAgent` interface. Drivers `claude()`, `codex()`, `muse()`; agent-neutral
  `AgentEvent` stream and `AgentResult`; abort, timeout and process-group kill;
  `detectAgents` / `findExecutable`; `cliAgent()` for custom drivers. See
  [docs/agents.md](docs/agents.md).
- Live agent sessions over JSON-RPC: `codexLive()` (`codex app-server`) and `museLive()`
  (`muse serve`) with `AgentRun.steer()` and `AgentTask.onApproval`; `liveAgent()` and
  `RpcPeer` for custom live drivers; `approval-resolved` event.
- `AgentTask.mcpServers` (HTTP and stdio) for `claude`, `codex` and `codexLive`; header
  secrets stay out of argv. Drivers can set up and clean up per task via `prepare`.
- `scrubEnv`, `withoutProviderCredentials` and `PROVIDER_CREDENTIAL_VARS` for child
  environments; `runWithVerify` verify-and-repair loop.
- Drivers `gemini()`, `cursor()` and `opencode()`; `hostedAgent()` adapts a
  `HostedAgentProvider` (start / poll / send / cancel) to `CodingAgent`.
- Driver `copilot()` for GitHub Copilot CLI (`--output-format json`), with MCP servers via
  `--additional-mcp-config` and `allowTools` / `denyTools` permission patterns.

### Notes

- The core `genaicode` entry is unchanged and still spawns nothing.

## 2.2.0 — 2026-07-26

### Added

- Portable `responseFormat` on `GenerationRequest` / request builders
  (`text` | `json` | `json_schema`), mapped by OpenAI and Google adapters
- Portable `thinking` controls (`false` | `{ budgetTokens?, level? }`), mapped by
  Anthropic (budget / disable) and Google (budget or level)
- `.json()` sets `responseFormat: { type: 'json' }` when no format was already chosen
- Capability flags: `jsonResponse`, `thinking`

### Notes

- Additive only; provider `generationConfig` / Anthropic `thinking` factory options still
  work as escape hatches for vendor-only knobs.
- On Google, `thinking: false` and `budgetTokens: 0` map to `thinkingLevel: MINIMAL`
  (Gemini 3 rejects `thinkingBudget: 0`). JSON `responseFormat` also defaults Google
  thinking to `MINIMAL` when unset, so small token budgets are not spent only on thoughts.
- Provider E2E covers JSON response format and thinking knobs when credentials are set.

## 2.1.0 — 2026-07-25

Publishes the Phase 3–4 work already on `master`. npm `2.0.0` shipped the 2.0
kernel and provider adapters only; this minor adds the remaining public surface
documented in the README and [semver policy](docs/semver.md).

### Added

- Provider-neutral streaming (`StreamEvent`, `.stream()` / `.streamText()`,
  native streams for OpenAI / Anthropic / Google with generate→stream fallback)
- Built-in middleware: `timingPlugin`, `rateLimitPlugin`, `cachePlugin`,
  `fallbackPlugin`, `fallbackProvider`
- Retry helpers: `classifyError`, `isRetryable`, `withRetry` (+ [docs/retry.md](docs/retry.md))
- `ProviderCapabilities` on `ModelProvider`
- Compatibility fixtures for multimodal and tool-call round trips
- Framework examples under `examples/` (HTTP handler, queue worker, cron job)
- Written guidance: [docs/semver.md](docs/semver.md),
  [docs/provider-packages.md](docs/provider-packages.md)

### Notes

- Additive API only; no breaking changes from `2.0.0`.
- Retries remain opt-in application policy (no hidden retries in core).
- Provider SDKs stay bundled behind `genaicode/providers` for 2.x.

## 2.0.0 — 2026-07-24

Major pivot from coding agent to backend LLM toolkit.

- `genaicode()` client, immutable request builders, conversation chains
- `PromptItem` IR and prompt/result helpers
- OpenAI, OpenAI-compatible, Anthropic, Gemini, and Vertex adapters
- `GenAIPlugin` middleware contract
- Coding-agent CLI/UI/tools removed; `npx genaicode` prints migration guidance
  (1.x remains on the `1.x` branch / `genaicode@1`)
