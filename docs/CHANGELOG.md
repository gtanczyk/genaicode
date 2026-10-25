# Changelog

## Unreleased

### Added

- `genaicode acp`: the Agent Client Protocol (version 1) on stdin/stdout, so editors (Zed,
  JetBrains) and apps in any language (a game engine's editor, a Tauri or native app) can run
  the installed agent CLIs: sessions with MCP servers, streamed text and tool calls, permission
  requests, cancel, and config options for the agent, its effort and approvals. See
  [embedding.md](embedding.md#any-language-the-agent-client-protocol).
- `autoApprove` in `createAppAgent` answers the agent CLI's own permission prompts the app
  decides itself (e.g. its auto-approve setting); the rest still wait for the user.
- An `AppTool` may return `{ text, images }`: the images (e.g. a screenshot of the app)
  reach the agent as MCP image content. A write tool's outcome stays its text.
- `dev.commit: false` and `dev.only: true` in `createAppAgent`: an app that delivers the
  agent's edits itself (not a git commit) drops `propose_commit`, and an app that is only ever
  edited starts in `dev` mode with no `use` mode to switch to.
- Auto-approve in `genaicode chat` and `genaicode ui`: `a` on a permission request (or
  `/auto`, or the Auto-approve chip in the browser) approves it and everything after it;
  `/auto off` asks again. `-y` starts with it on.
- `genaicode embed` makes projects without a dev server work too: the agent writes a small
  dev-only server that serves the pages with the panel injected, leaving the files and the
  build untouched. That server opens the browser, and the agent's report starts with the one
  command to run. It also keeps its shell commands few, since each one may need approval.
- `createDevOverlay()` in `genaicode/ui`: the Vite plugin's overlay (the wolf, its error
  badge, "Fix N errors", the resizable panel) for any other Node dev server, as
  `handle(req, res)` / `middleware` plus `injectHtml(html)`. `genaicode embed` now uses it
  for non-Vite dev servers and for the dev server it writes, instead of a hand-made button.
- `!command` in `genaicode chat` (`!` on an empty prompt switches to shell mode, as in
  Claude Code) and `genaicode ui` runs a shell command in the project
  (e.g. `!npm run dev` after `genaicode embed`), its output in the transcript; `/stop`, Esc
  or the Stop button end it and what it started, `!!` sends a leading `!` to the agent.
  `<AgentChat canStop>` offers Stop while the agent is idle.
- `Markdown` renders GFM tables (alignment, `\|` escapes, horizontal scroll when wide),
  `~~strikethrough~~` and task lists (`- [x]`). A table may follow a paragraph line directly.

### Changed

- The overlay's wolf stays light in dark mode, with a ring, so it shows on dark pages.
- The embed skill moved to `docs/skills/genaicode-embed/SKILL.md` (it was `skills/`).

## 2.18.0

### Added

- `genaicode embed [request]`: your own agent adds genaicode to the project in the current
  directory. It gets instructions (the Vite overlay; a development-only panel through
  `genaicode/ui` for webpack, Next.js, Express and other Node dev servers; the in-app agent;
  or `genaicode ui` alongside) and decides from what it reads in the project. The chat opens
  in the terminal (`--ui`: browser), headless without one; `--print` prints the
  instructions for any other agent. They ship as a Claude Code skill too,
  `skills/genaicode-embed/SKILL.md`.
- One session in the terminal and the browser: `/web` in `genaicode chat` opens it in the
  browser (`/web off` stops the server), `genaicode chat --web` does so at start, and Enter
  in the terminal running `genaicode ui` continues there with the browser still connected.

- `<AgentChat foldSteps>` (and `<AppAgentChat foldSteps>`): each turn's work (tools, edits,
  interim text) folds into one "N steps" line that opens on click, naming the running tool.
  The answer, errors, steering input and open approvals stay in view.
- `AppAgent.notify(text)`: a note from the app to its agent, e.g. that a background job a tool
  started has finished. It goes ahead of queued prompts and never starts a conversation.
- `useAppAgent(basePath, { eventsUrl })`: the event stream URL, for an app that puts a key in
  its query because `EventSource` cannot send headers.
- `genaicode/app-agent`: a coding agent inside your own local app. `createAppAgent` serves the
  app's tools to the agent over MCP, turns write tools into actions the user approves, gives
  the agent the open page with link chips and navigation, and in `dev` mode lets it edit the
  app and propose a commit of exactly the reviewed tree. `createAppAgentHandler` serves it to
  the page over HTTP and server-sent events, for any Node server. Switching agent or mode keeps
  the conversation, `trace` logs prompts, MCP calls, decisions and turns, and
  `POST /approvals/:id` answers the agent CLI's own permission prompts.
- `genaicode/react`: `AppAgentChat`, the page side of an app agent (chat, link chips, action
  cards with the commit diff, agent and mode pickers), and `useAppAgent` for a page of your own.
- `codex({ config })`: extra `-c key=value` overrides, e.g. `{ 'features.shell_tool': false }`.
- `codex({ onlyTaskMcpServers })` and `copilot({ onlyTaskMcpServers })`: switch off the MCP
  servers the CLI loads from its own config, leaving only the task's. The app agent uses it.
- `copilot({ excludedTools })`: `--excluded-tools`, e.g. `['web_fetch', 'web_search']`.
- `claude({ settings })`: `--settings` above the user's and the project's, e.g.
  `{ disableAllHooks: true }`; merged with the sandbox settings of `task.permissions`.
- `AgentSession.send(text, { note: true })` for host notes: never steered, run before queued
  prompts, and kept through a user stop until the next prompt; `SessionState.notes` lists them.
  `send(text, { queue: true })` waits for its own turn instead of steering a running one.
- `genaicode/react` exports `useFollowScroll`, the hook that keeps a transcript at its newest
  line until the user scrolls up (`<AgentChat>` now uses it, and also re-pins when its box is
  resized), and `installResizeHandle` with `storedSize`: a framework-free panel-edge resize
  handle with pointer drag, arrow keys, Home/End, Escape to undo a drag, Enter or double-click
  to reset, and a kept ARIA range. The gamedev.pl Play workbench uses both.

### Fixed

- `codex()` reads MCP tool results: a successful call (`error: null`) is no longer reported as
  failed, and its text becomes the tool output. `codex exec` never asks for approval, so it now
  pre-approves the tools of `task.mcpServers` (`default_tools_approval_mode`); before, Codex
  refused every call to them. `allowMcpTools: false` keeps the old behavior.
- `<AgentChat>` can shrink in a flex container narrower than its widest line.
- Anthropic structured outputs: the converter drops the schema keywords the API rejects with a
  400 (`minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `maxItems`,
  `uniqueItems`) and lowers `minItems` above 1 to 1, the largest value accepted. It walks only
  real subschemas, so a property that happens to be named `maximum` is kept. Callers still
  validate the answer against their own schema.
- `genaicode/vite` overlay: Escape closes the panel and hands the focus back to the wolf, from the
  wolf or anything in the panel (inside the chat frame the key stays with the UI). The wolf names
  the panel it toggles with `aria-controls`.

### Changed

- README and the package description lead with the coding agents: a 20-second demo, the
  `npx genaicode run --verify` one-liner, then `genaicode/agents`. The LLM layer moved below
  them as "Also: a thin LLM layer", and the 1.x note to the end.
- `defaultAppAgents`: Claude cannot start subagents (`Task`, `Agent`) in either mode; one can
  outlive the turn, so its answer never reaches the user.

## 2.13.3 — 2026-10-17

### Added

- The Anthropic provider honors `responseFormat: { type: 'json_schema' }`: it sends the schema as
  `output_config.format` (structured outputs), next to any `effort`, so the answer is decoded
  against the schema instead of only asked for in the prompt. Anthropic requires
  `additionalProperties: false` on every object, so the converter adds it where the schema leaves
  it out. A schemaless `{ type: 'json' }` still maps to nothing: Anthropic has no such mode.

## 2.13.2 — 2026-10-09

### Fixed

- Approvals no longer use `AbortSignal.any`, which Node 20.0–20.2 lack.
- `hostedAgent()` refuses `permissions.approval: 'ask'`: the provider contract has no way to bring a question back to `onApproval`.
- `codexLive()` denies Codex permission-profile requests without asking when `task.permissions.sandbox` is `workspace-write` or `read-only`, since the profile would widen that sandbox. The docs now say that a Codex command approval in `ask` mode can still let that step leave the sandbox.

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
  [docs/releasing.md](releasing.md).

## 2.4.0 — 2026-09-24

### Added

- `genaicode/agents` subpath (experimental): run installed coding-agent CLIs behind one
  `CodingAgent` interface. Drivers `claude()`, `codex()`, `muse()`; agent-neutral
  `AgentEvent` stream and `AgentResult`; abort, timeout and process-group kill;
  `detectAgents` / `findExecutable`; `cliAgent()` for custom drivers. See
  [docs/agents.md](agents.md).
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
documented in the README and [semver policy](semver.md).

### Added

- Provider-neutral streaming (`StreamEvent`, `.stream()` / `.streamText()`,
  native streams for OpenAI / Anthropic / Google with generate→stream fallback)
- Built-in middleware: `timingPlugin`, `rateLimitPlugin`, `cachePlugin`,
  `fallbackPlugin`, `fallbackProvider`
- Retry helpers: `classifyError`, `isRetryable`, `withRetry` (+ [docs/retry.md](retry.md))
- `ProviderCapabilities` on `ModelProvider`
- Compatibility fixtures for multimodal and tool-call round trips
- Framework examples under `examples/` (HTTP handler, queue worker, cron job)
- Written guidance: [docs/semver.md](semver.md),
  [docs/provider-packages.md](provider-packages.md)

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
