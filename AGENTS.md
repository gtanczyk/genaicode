# AGENTS.md

## Cursor Cloud specific instructions

GenAIcode is a provider-neutral TypeScript LLM toolkit (a library), not a running
service or UI app. There is nothing to "serve"; you develop and validate it via the npm
scripts in `package.json`.

- Standard commands live in `package.json` scripts: `npm run lint`, `npm run type-check`,
  `npm test` (unit, vitest), `npm run build` (tsc), and `npm run check` (all of them).
- The `genaicode` bin (`dist/cli.js`, built from `src/cli.ts`) only prints 2.x migration
  guidance; it is not the product. The product is the library API exported from
  `src/index.ts` and `src/providers.ts`.
- `npm run test:e2e` hits real providers and is credential-gated: tests are skipped unless
  provider env vars are set (`OPENAI_API_KEY`/`OPENAI_MODEL`, `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`,
  `GEMINI_API_KEY`/`GEMINI_MODEL`). Without keys they skip (not fail), so this is not a blocker.
- To exercise core functionality without provider credentials, implement a small custom
  `ModelProvider` (`{ name, async generate(request) }`) and pass it to `genaicode(provider)`.
  This is a documented first-class extension point and runs the full prompt/chain/plugin/tool
  code paths locally with no external calls.
- `.nvmrc` pins Node 20, but `engines` allows `>=20`; Node 22 also works fine.
- A husky `pre-commit` hook runs `lint-staged`, which runs `prettier --write` on staged
  `*.{js,ts,md}`. Commits may reformat staged files.
