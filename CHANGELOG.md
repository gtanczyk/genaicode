# Changelog

One line per change, written for someone upgrading `genaicode`. The category decides the next
version: **Breaking** bumps major, **Added** bumps minor, **Fixed** bumps patch, **Internal** never
releases. A PR that changes `src/` (tests excluded) must add a line under `## Unreleased`, or CI
fails. Merging to master refreshes the `release` PR; merging that publishes to npm. See
[AGENTS.md](AGENTS.md#changelog-and-releases).

## Unreleased

### Added

- `genaicode/browser`: an agent that runs in the web page on the browser's built-in model (Gemini Nano through Chrome's Prompt API), with no server and no key. `nano()` is a `CodingAgent` that calls page tools through schema-constrained choices, `createPageAgent()` is the conversation (approval of `write` tools, model download, context use), `exposeWebMcp()` offers the same tools to outside agents over WebMCP and `webMcpTools()` reads them back; `<PageAgentChat>` and `usePageAgent` in `genaicode/react` draw it (#168).

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

Earlier versions: see the git tags (`v2.23.0` and older).
