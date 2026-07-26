# Changelog

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
