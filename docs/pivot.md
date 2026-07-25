# GenAIcode 2.0 pivot plan

## Product thesis

Backend teams often need more than a raw LLM SDK and much less than an agent framework.
GenAIcode should be the small layer that makes routine model calls portable, composable,
testable, and safe to retry.

The analogy is jQuery's role at its best: a tiny, predictable entry point over inconsistent
platform APIs. GenAIcode's equivalent of the DOM is `PromptItem`, and provider converters
are the compatibility layer.

## Product surface

The 2.0 core has four pieces:

1. `PromptItem`, a provider-neutral prompt and tool-call IR.
2. Prompt converters, including a protocol for application domain objects.
3. A callable, immutable request builder for common generation tasks.
4. A lightweight conversation chain that carries normalized prompt history.

Provider adapters translate only at the edge. They do not own application policy,
execute tools, mutate files, or silently choose cost tiers.

Extension remains a core feature, but changes shape:

- third-party AI services implement and export `ModelProvider`;
- request/result hooks use composable `GenAIPlugin` middleware;
- packages are loaded with ordinary JavaScript imports rather than runtime TypeScript
  compilation and a process-global registry.

## Removed product

The following 1.x capabilities are intentionally removed:

- coding-agent orchestration and coding-specific prompts;
- repository discovery, project profiles, file operations, and shell execution;
- interactive CLI and browser UI;
- Vite development plugin;
- context compression and repository summarization;
- agent-oriented plugin and action systems;
- image-editing operations and coding evaluations.

This is a major-version break. The old implementation remains available in git history
and in the 1.x npm line.

## API principles

- The happy path is `await ai(prompt).text()`.
- Chaining adds policy without introducing a configuration framework.
- Builders are immutable and contain no process-global state.
- `PromptItem` and conversion functions are public, stable contracts.
- Providers accept explicit credentials and model names.
- Providers and middleware are open extension contracts.
- Conversation chains add only successful turns and serialize concurrent calls.
- Validation, retry loops, and every side effect belong to application code.

## Delivery phases

### Phase 1: coherent kernel — implemented

- Publish the new core API.
- Ship OpenAI and OpenAI-compatible conversion/adapters.
- Cover normalization, immutability, structured output, tools, and chains with unit tests.
- Mark 2.0 as a major-version migration with no 1.x compatibility shim.

### Phase 2: provider breadth — implemented on the pivot branch

- Extract Anthropic and Google converters from the proven 1.x implementations.
- Support OpenAI, OpenAI-compatible APIs, Anthropic, Gemini AI Studio, and Vertex AI.
- Add converter contract tests with multimodal and tool-call fixtures.
- Keep provider SDKs isolated behind the `genaicode/providers` export.

### Phase 3: backend ergonomics — implemented

- Streaming with a provider-neutral event IR — implemented (`StreamEvent`,
  `RequestBuilder.stream` / `streamText`, native provider streams with generate
  fallback).
- Middleware for observability, rate limiting, caching, and fallback —
  implemented (`timingPlugin`, `rateLimitPlugin`, `cachePlugin`, `fallbackPlugin`,
  `fallbackProvider`).
- First-class schema adapters without requiring a specific validation library — implemented.
- Small framework examples for HTTP handlers, queues, and cron jobs — implemented
  under `examples/`.
- Re-evaluate separate provider packages if dependency size becomes material —
  evaluated; keep bundled for 2.x (see [provider-packages.md](./provider-packages.md)).

### Phase 4: hardening — implemented

- Provider capability metadata — implemented (`ProviderCapabilities` on
  `ModelProvider`).
- Retry classification and idempotency guidance — implemented
  (`classifyError` / `withRetry` + [retry.md](./retry.md)).
- Compatibility fixtures for multimodal and tool-call round trips — implemented
  under `src/providers/fixtures/`.
- Stable extension contracts and a written semver policy — implemented
  ([semver.md](./semver.md)).

### Release status

- `2.0.0` on npm shipped the Phase 1–2 kernel and provider adapters.
- `2.1.0` publishes Phases 3–4 (streaming, middleware, capabilities, retry
  helpers, fixtures, examples, and related docs). See [CHANGELOG.md](../CHANGELOG.md).

## Success measures

- A first model call needs fewer than ten lines of application code.
- A custom provider requires one small interface implementation.
- Provider converters can be tested without network calls.
- The installed dependency tree stays substantially smaller than 1.x.
- No core API assumes a coding workflow.
