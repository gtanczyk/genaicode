# Semver and extension contracts

GenAIcode 2.x follows semantic versioning for the published TypeScript API.

## Public contracts (semver-stable)

These are covered by minor/patch compatibility within 2.x:

- `genaicode()` client, immutable request builders, and conversation chains
- `PromptItem`, `GenerationRequest`, `GenerationResult`, `StreamEvent`
- `ModelProvider` and `GenAIPlugin` interfaces
- Prompt helpers (`prompt`, `system`, `user`, `assistant`, `asPrompt`, …)
- Result helpers (`resultText`, `parseJsonResult`, …)
- Built-in middleware factories (`timingPlugin`, `rateLimitPlugin`, `cachePlugin`,
  `fallbackPlugin`, `fallbackProvider`)
- Error helpers (`classifyError`, `isRetryable`, `withRetry`)
- Provider factories and converter functions exported from `genaicode/providers`

## Additive changes (minor)

Safe in a minor release:

- New optional fields on request/result/stream types
- New optional methods on `ModelProvider` / `GenAIPlugin` (callers must feature-detect)
- New exports and middleware helpers
- New provider adapters behind `genaicode/providers`
- New capability flags on `ProviderCapabilities`

## Breaking changes (major)

Require a new major version:

- Removing or renaming exports
- Changing the meaning of existing `PromptItem` fields
- Making previously optional callback/plugin behavior mandatory
- Changing default retry/side-effect policy (there is none today; introducing
  hidden retries would be a major behavioral break)
- Moving provider SDKs in a way that removes the current `genaicode/providers`
  entry without a compatibility window

## Non-guarantees

- Exact shapes of `raw` provider payloads
- Timing of stream events beyond the `StreamEvent` discriminant
- Dependency versions of underlying provider SDKs within a major (may bump in
  minors when needed for security or API drift)
- Example apps under `examples/` (illustrative only)

## Plugin and provider authors

- Depend on TypeScript types from `genaicode`, not on private `dist/` paths.
- Prefer ordinary package exports over runtime loaders.
- Feature-detect `provider.stream` and `provider.capabilities`.
- Treat `metadata` on `GenerationRequest` as an open bag for your middleware;
  do not require core to understand your keys.
