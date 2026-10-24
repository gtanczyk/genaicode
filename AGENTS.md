# AGENTS.md

## Cursor Cloud specific instructions

GenAIcode is a provider-neutral TypeScript LLM toolkit (a library), not a running
service or UI app. There is nothing to "serve"; you develop and validate it via the npm
scripts in `package.json`.

- Standard commands live in `package.json` scripts: `npm run lint`, `npm run type-check`,
  `npm test` (unit, vitest), `npm run build` (tsc), and `npm run check` (all of them).
- The `genaicode` bin (`dist/cli.js`, built from `src/cli.ts` and `src/cli/`) is a thin
  front end to the `genaicode/agents` drivers (`genaicode agents`, `genaicode run`, and the
  `chat` / `ui` front ends in `src/ui/`, bundled by `scripts/build-ui.mjs` into `dist/ui`). It
  must not grow an agent loop or prompts of its own, and the library entry points never import
  it or `src/ui`. The one prompt it ships is `genaicode embed`'s, kept in
  `skills/genaicode-embed/SKILL.md` so it also works as a Claude Code skill.
- `npm run test:browser` runs the `genaicode/vite` overlay in headless Chromium through
  Playwright (`*.browser.test.ts`, not part of `npm test`/`check`); it needs
  `npx playwright install chromium` once.
- `npm run test:e2e` hits real providers and is credential-gated: tests are skipped unless
  provider env vars are set (`OPENAI_API_KEY`/`OPENAI_MODEL`, `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`,
  `GEMINI_API_KEY`/`GEMINI_MODEL`). Without keys they skip (not fail), so this is not a blocker.
- To exercise core functionality without provider credentials, implement a small custom
  `ModelProvider` (`{ name, async generate(request) }`) and pass it to `genaicode(provider)`.
  This is a documented first-class extension point and runs the full prompt/chain/plugin/tool
  code paths locally with no external calls.
- `engines` asks for Node `>=20`; CI runs Node 22.
- `npm run format` runs `prettier --write .`; there is no pre-commit hook, so run it before
  committing.
