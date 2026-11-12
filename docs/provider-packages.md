# Provider package split evaluation

Phase 3 asked whether OpenAI, Anthropic, and Google adapters should move into
separate packages to shrink the default install.

## Current shape

| Package surface        | Role                                      |
| ---------------------- | ----------------------------------------- |
| `genaicode`            | Core client, IR, plugins, middleware      |
| `genaicode/providers`  | Adapters + public converters              |

Hard dependencies today (approximate installed sizes in this repo's lockfile):

- `openai` ~12MB
- `@anthropic-ai/sdk` ~5MB
- `@google/genai` (+ tree) ~14MB

Together the provider SDKs dominate runtime dependency weight versus the small
core TypeScript sources.

## Options considered

1. **Keep bundled (status quo)**  
   One install, one version matrix, simplest DX. Cost: every consumer downloads
   all three SDKs even if they only use one.

2. **Separate packages** (`genaicode-openai`, `genaicode-anthropic`, …)  
   Smallest installs. Cost: version skew between core and adapters, more release
   surface, harder getting-started docs.

3. **Peer dependencies + optional installs**  
   Core stays free of SDKs; `genaicode/providers` re-exports adapters that import
   peers. Cost: peer warnings and slightly worse first-run DX.

## Decision for 2.0

**Keep provider adapters bundled behind `genaicode/providers` for 2.x.**

Reasons:

- The product pitch is a tiny portable layer with batteries-included adapters.
- Converter functions are part of the public compatibility story and are tested
  together against shared fixtures.
- Absolute weight (~30MB of SDKs) is material but still far smaller than GenAIcode
  1.x; success measures emphasize “substantially smaller than 1.x,” not absolute
  minimalism.
- Splitting before streaming, middleware, and capability metadata settled would
  freeze the wrong package boundaries.

## Revisit triggers

Split (or move to optional peers) when any of these become true:

- Published install size or cold `npm install` time becomes a documented user pain.
- A provider SDK forces frequent breaking upgrades independent of core.
- Tree-shaking cannot eliminate unused SDKs for bundlers targeting edge runtimes.

Until then, application authors who need a zero-SDK core can implement
`ModelProvider` directly and ignore `genaicode/providers`.
