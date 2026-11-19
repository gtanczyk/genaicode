# Changelog

One line per change, written for someone upgrading `genaicode`. The category decides the next
version: **Breaking** bumps major, **Added** bumps minor, **Fixed** bumps patch, **Internal** never
releases. A PR that changes `src/` (tests excluded) must add a line under `## Unreleased`, or CI
fails. Merging to master refreshes the `release` PR; merging that publishes to npm. See
[AGENTS.md](../AGENTS.md#changelog-and-releases).

## Unreleased

### Added

- An installer for the `genaicode` command (`curl -fsSL https://raw.githubusercontent.com/gtanczyk/genaicode/master/scripts/install.sh | sh`) that keeps itself up to date: once a day a background check installs a new version beside the running one; `genaicode update [--check] [--version <v>] [--auto on|off]` updates by hand and prints the release notes (#202)
- Ask an agent what is open across all of them: `genaicode chat --sessions` (and `ui --sessions`) gives the chat's agent the session index as MCP tools (`sessions_projects`, `sessions_list`, `sessions_read`), and `genaicode sessions mcp` serves them to any agent on stdio. In code: `sessionTools()` and `serveMcpStdio()` in `genaicode/agents` (#201)

## 2.35.1 — 2026-11-19

### Fixed

- Copilot CLI sessions that were opened and left with nothing said (no event log, unknown to the CLI's index) are no longer listed, so `sessions doctor` no longer reports Copilot's store as broken because of them; the Cursor reader is stamped as checked with Cursor agent 2026.10.22 (#199)

## 2.35.0 — 2026-11-18

### Added

- `pack({ lead, members })` in `genaicode/agents`: one agent over the installed ones. The lead delegates to the others in parallel git worktrees through MCP tools and merges their work; new `subtask-start`, `subtask` and `subtask-update` events (#184).
- `listSessions()` and `genaicode sessions`: one list of the sessions coding agents keep on this machine, grouped by project, with state (active, waiting for you, unfinished), latest prompt and the id to resume. Every driver names its store in `agent.sessions` (Claude Code, Codex, Copilot, Cursor, Gemini CLI, Antigravity, Muse, Vibe; `null` for opencode); SQLite-backed stores require Node 22.5+ (`node:sqlite`), and `SessionSource` is the seam for vendor clouds (#186).
- `listSessions()` reads vendor clouds too: `anthropicManaged` lists its agent's sessions and `cursorCloud` the account's Cloud Agents (`where: 'cloud'`, with a link to open them); `geminiManaged`, `openaiManaged` and `hostedAgent` say `sessions: null`, as their APIs list nothing (#187).
- `genaicode ui` and `chat --web`: a Sessions view in the browser lists every agent's sessions by project, with search, filters by agent, state and period, and the command that continues each one (#188).
- Continue a session in another agent: `--from <session id>` in `genaicode chat`, `ui` and `run`, `/continue <id>` in the chat and **Continue here** in the browser's Sessions view bring a Claude Code or Codex session into the chat; its own agent resumes it, any other gets a recap and the transcript. In code: `SessionSource.read()`, `readSession()`, `findSession()` and `AgentSession.adopt()` (#189).
- Sessions of Gemini CLI and Copilot CLI can be taken over too (`--from`, `/continue`, **Continue here**): their sources have `read()`, with `geminiTranscript()` and `copilotTranscript()` (#190).
- Sessions of Muse, Antigravity and Vibe can be taken over too (`museTranscript()`, `antigravityTranscript()`, `vibeTranscript()`); Copilot CLI sessions without an event log are read from its `session-store.db`, and its tool results are kept; `SessionSource.find()` lets `--from` look a Claude Code session up by id without reading every transcript (#191).
- `genaicode hooks install`: Claude Code and Codex report through their own hooks what a session does, so `listSessions()`, `genaicode sessions` and the Sessions view show which sessions ask for approval (`waitingFor`, `waitingTool`) and which finished their turn; `installHooks()`, `recordHook()`, `readLive()`, `withLive()` in `genaicode/agents` (#192).
- `genaicode sessions doctor` and `checkSessions()`: per session store, how many sessions it lists, how many have a prompt and a directory, whether the newest conversations open, and whether the agent's CLI is newer than the one the reader was checked with (`SessionSource.verified`). Counts only; exits 1 when a store reads differently than expected (#193).
- Codex sessions can be asked of Codex itself: `codexSessions({ via: 'app-server' | 'auto' })` or `GENAICODE_CODEX_SESSIONS=app-server` lists and reads through `codex app-server` (`thread/list`, `thread/turns/list`), falling back to the files; `genaicode sessions doctor --api` compares what the files gave with what Codex lists. `openCodexServer()`, `codexThreads()`, `readCodexThread()` exported. The files stay the default (#194).

### Fixed

- OpenAI: `openai()` runs on the Responses API, so function tools work on GPT-6 models (`gpt-6.2-astra`, `gpt-6.2-sol`), which reject them on chat completions; `openai({ api: 'chat' })` keeps chat completions (use it or `openaiCompatible()` for chat-completions-only `baseURL` proxies). Temperature is left out for reasoning models (o-series, GPT-5 and later), which accept only their default. `raw` is now the Responses API `Response` (#183).
- Gemini: `thinking: false` and JSON responses work on Gemini 3.7+, Gemini 3.8 Flash and Gemini 4 (`gemini-4-argon`, `gemini-4-carbon`, `gemini-4-hydrogen`), which reject the `MINIMAL` thinking level: they now get `LOW` (#182).

## 2.34.0 — 2026-11-18

### Added

- `withFallback()` gains `info()` and `forget()` when its agents have them, and `nano()` gains `info()`: `createPageAgent({ agent: withFallback([...]) })` shows what the agent that runs first takes (image attachments where the model does) and when an agent over its allowance is back, and "New" clears every agent's conversation (#177).
- `managedAgent()` and `ManagedProvider` in `genaicode/agents`: one contract for hosted agent platforms whose sessions outlive the process (Anthropic, Gemini, OpenAI and Cursor managed agents). Sessions are addressed by id (`start`, `get`, `events` or a live `watch`, `send`, `answer`, `interrupt`, `release`, `delete`), report usage and cost, pass `task.budget` to the platform's own cap (a stop there fails with `failure.kind: 'budget'`) and bring approvals back to `task.onApproval`. `hostedAgent()` now runs on it (`fromHosted()`) (#174).
- `anthropicManaged()` in `genaicode/agents`: tasks run as Claude Managed Agents sessions of an agent and environment you created once. Text streams live, `steer()` and `abort()` reach the session, paused tool calls come back as approvals, `task.budget.maxCostUsd` becomes the session's list-cost cap, `resume` continues a session, MCP bearer tokens go into a per-session vault, files and `https://github.com/...` workspaces are mounted, and custom tools run through `tools` handlers. Pass a client from an `@anthropic-ai/sdk` with `beta.sessions` (#178).
- `geminiManaged()` in `genaicode/agents`: tasks run on Gemini Managed Agents (Antigravity) through the Interactions API, on the Gemini API or Gemini Enterprise Agent Platform. Steps stream live and resume after a drop, `abort()` cancels the interaction, `resume` chains the next turn in the same environment, MCP servers go along with their headers, `task.budget.maxTokens` becomes the interaction's token cap, and files and git repositories are mounted in a fresh sandbox (#179).
- `openaiManaged()` in `genaicode/agents`: tasks run as OpenAI background responses with hosted tools (a hosted shell in a container kept for the session, web search, or your own list). Output items are polled in order and reported as messages and tool calls, `abort()` cancels the response, `resume` chains the next response, MCP servers go along with their bearer token, and `effort` and `maxTurns` map to `reasoning.effort` and `max_tool_calls` (#180).
- `cursorCloud()` in `genaicode/agents`: tasks run as Cursor Cloud Agents on a repository or pull request. The agent keeps one session id across turns (`resume` sends a follow-up run), its run streams live and resumes after a drop, `steer()` and `abort()` reach the running turn, MCP servers go along with their headers, and usage is the agent's total (#181).
- `genaicode/backend`: a model behind your server for the page agent. `createAgentBackend()` runs the tool loop on any `genaicode()` client, hands page-tool calls to the page and runs server tools for the signed-in user, keeps the conversation in an encrypted token (or a `store`), and holds costs with output, step, conversation and daily limits (`memoryLimiter()`); `handle(request)` takes a web `Request`, `toNodeListener()` serves Node. In `genaicode/browser`, `remote({ url, tools })` is its driver and `withFallback` is exported, so a page can fall back between the server and Gemini Nano (#175).

### Fixed

- Gemini: a tool call's `thoughtSignature` now goes back with it in the history (`ToolCall.signature`), so Gemini 3 accepts the next step of a tool loop; a streamed reply keeps the tool calls and images of every chunk, not only the last one's (#175).

## 2.33.0 — 2026-11-12

### Added

- `genaicode/browser`: an agent that runs in the web page on the browser's built-in model (Gemini Nano through Chrome's Prompt API), with no server and no key. `nano()` is a `CodingAgent` that calls page tools through schema-constrained choices, `createPageAgent()` is the conversation (approval of `write` tools, model download, context use), `exposeWebMcp()` offers the same tools to outside agents over WebMCP and `webMcpTools()` reads them back; `<PageAgentChat>` and `usePageAgent` in `genaicode/react` draw it (#168).
- Files in the page agent: `PageAgent.send(text, files)` and `nano().run({ attachments })` read text files into the prompt and hand images and audio to the browser's model where it takes them (`nano({ inputs: ['image', 'audio'] })`, `inputs()`, `state.model.inputs`). `<AgentChat attachments>` adds an attach button, paste, drop and a voice-message recorder to the composer (`onSend(text, files)`), and draws a turn's `attachments`; `<PageAgentChat attachments>` turns it on for the kinds the model takes (#171).

### Fixed

- `<AgentChat attachments>`: the message field takes the whole width of the composer and the attach, record, Stop and Send buttons sit in a row under it, instead of squeezing the field between them (#172).
- `nano()` asks each schema-constrained step on a copy of the model session (`clone()`): Chrome keeps a session's first `responseConstraint`, so the arguments call failed with `UnknownError` on Gemini Nano and fell back to a slow answer in words (#171).
- `nano()` (`genaicode/browser`) survives Chrome's `UnknownError` on a schema-constrained call by asking the model in words, retries a reply that failed before its first word, names the failed step in the error and reports each model call through `onModelCall` (#170).

## 2.32.0 — 2026-11-11

### Added

- Artifacts take audio and video (a player in the card; `artifactResponse(artifact, body, { range })` now returns a `status` and answers `Range` so players can seek; `maxMediaBytes`, `maxTotalBytes`), a published page can send the user's answers back to the agent (`parent.postMessage({ genaicode: 'submit', data }, '*')`, confirmed on the card; `<AgentChat onArtifactSubmit>`, `artifactSubmission()`), and an agent that takes over after a switch or failover is told what was published, by `name`, with the content of pages that exist nowhere else (#166).

## 2.31.0 — 2026-11-11

### Added

- Artifacts: agents with MCP support get a `publish_artifact` tool to show the user a self-contained HTML page, an image or a document. `startArtifactChannel()`, `createArtifactStore()`, `artifactResponse()` and `createAgentSession({ artifacts })` (an `artifact` transcript entry) in `genaicode/agents`; `<AgentChat artifactUrl renderArtifact>` shows a card with a sandboxed preview; `genaicode chat` and `ui` have it on by default (`--no-artifacts`) (#162).
- App agents publish artifacts too: `createAppAgent({ artifacts: true })` offers `publish_artifact`, `createAppAgentHandler` serves `GET <basePath>/artifacts/:id` sandboxed and behind `authorize`, and `<AppAgentChat>` shows the cards (`renderArtifact` to replace them) (#164).

## 2.30.0 — 2026-11-07

### Added

- Opt-in failover between agents: `result.failure` (`quota`, `auth`, `unavailable`, `crash`, `budget`), `shouldFailOver()`, `withFallback([...agents])`, `createAgentSession({ fallback })`/`setFallback()` with a `failover` transcript entry, `createAppAgent({ fallback })`/`configure({ fallback })`, and `run|chat|ui --fallback` plus `/fallback` in the chat (#160).
- Switching agents keeps the conversation: after `AgentSession.setAgent()` (and `/agent` in `genaicode chat` / `ui`) the next agent's first prompt carries a recap of the turns it missed plus the path of a full Markdown transcript in `.genaicode/handoff/` in the cwd; switching back resumes the agent's own session and tells it only what it missed. Opt out with `setAgent(agent, { handoff: false })`, `handoff: false`, or `/agent name --fresh`.

## 2.29.0 — 2026-11-07

### Added

- `rate-limit` events report plan limits (Claude's 5-hour/weekly windows, `codexLive` rate limits; any quota error as `window: 'quota'`), and `task.budget` (`maxTokens`, `maxCostUsd`, `warnAt`) emits `budget-warning` then stops the run; sessions take `budget` and keep `state.rateLimits`, `<AgentChat>`/`chat`/`ui` show limit chips, and `run|chat|ui` take `--max-tokens`/`--max-cost` (#157).

## 2.28.1 — 2026-11-04

### Fixed

- `antigravity()` tool calls show what they act on: MCP tools are named `mcp__<server>__<tool>`, arguments gain `path`/`command`/`description`, and a `read_file` shows the lines it read.

## 2.28.0 — 2026-11-04

### Added

- `antigravity()` drives `agy acp` with `task.mcpServers`, `task.resume`, `steer()`, and `onApproval` (#151).

## 2.27.0 — 2026-10-30

### Added

- The app agent chat can dismiss settled action cards.

Earlier versions: [changelog-2.26-and-older.md](changelog-2.26-and-older.md) and the git tags.
