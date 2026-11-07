# Changelog

One line per change, written for someone upgrading `genaicode`. The category decides the next
version: **Breaking** bumps major, **Added** bumps minor, **Fixed** bumps patch, **Internal** never
releases. A PR that changes `src/` (tests excluded) must add a line under `## Unreleased`, or CI
fails. Merging to master refreshes the `release` PR; merging that publishes to npm. See
[AGENTS.md](AGENTS.md#changelog-and-releases).

## Unreleased

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
