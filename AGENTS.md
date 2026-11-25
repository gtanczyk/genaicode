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
  `docs/skills/genaicode-embed/SKILL.md` so it also works as a Claude Code skill.
  `docs/skills/genaicode-sessions/SKILL.md` is the skill `genaicode sessions mcp` serves beside
  its tools (MCP skills extension); it says how to use the tools, nothing else.
- `npm run test:browser` runs the `genaicode/vite` overlay in headless Chromium through
  Playwright (`*.browser.test.ts`, not part of `npm test`/`check`); it needs
  `npx playwright install chromium` once.
- `src/ui/visual.browser.test.ts` (part of `npm run test:browser`) compares screenshots of
  `<AgentChat>` and the `genaicode ui` page, in both themes, with `src/ui/__screenshots__/<platform>/`.
  A change to how they look must come with new baselines:
  `GENAICODE_UPDATE_SCREENSHOTS=1 npm run test:browser -- visual` rewrites those of your platform;
  take the other platform's from the `visual-screenshots` artifact of the `Lint and test` run
  (the PNG files without `.diff`). Fonts differ per OS, so a platform without a directory is not compared.
- `npm run test:e2e` hits real providers and is credential-gated: tests are skipped unless
  provider env vars are set (`OPENAI_API_KEY`/`OPENAI_MODEL`, `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`,
  `GEMINI_API_KEY`/`GEMINI_MODEL`). Without keys they skip (not fail), so this is not a blocker.
- To exercise core functionality without provider credentials, implement a small custom
  `ModelProvider` (`{ name, async generate(request) }`) and pass it to `genaicode(provider)`.
  This is a documented first-class extension point and runs the full prompt/chain/plugin/tool
  code paths locally with no external calls.
- `engines` asks for Node `>=22.5` (`node:sqlite`); CI runs Node 22.
- `npm run format` runs `prettier --write .`; there is no pre-commit hook, so run it before
  committing.

## Changelog and releases

`docs/CHANGELOG.md` is the release source of truth; nobody runs `npm version` by hand.

- A PR that changes `src/` (tests excluded) adds an entry under `## Unreleased`. Write a bold
  title in present tense for someone using the app, up to 100 characters, ending the line with
  the PR number, for example `- **Resume a session from All sessions.** (#149)`. The Changelog
  guard checks this format. Put optional behaviour and API details in indented Markdown bullets.
- Prefix an entire library-only entry with `- lib: **Title.** (#149)`, or an individual detail
  with `  - lib: `. What's new shows the highlights, app titles and their expandable app details.
  GitHub Release notes include all public entries and details. Older one-line entries remain readable.
- The category decides the bump: `### Breaking` major, `### Added` minor, `### Fixed` patch,
  `### Internal` (refactors, tooling, nothing a user notices) no release. The highest one present wins.
- A paragraph between `## Unreleased` and its first category opens that release's notes (the
  GitHub Release text). Use it for a major release; leave it out otherwise.
- `release-pr.yaml` runs `scripts/release.mjs cut` on every master push that moves `docs/CHANGELOG.md`
  and keeps one PR, **`release: vX.Y.Z`** on branch `release/next`, up to date. Merging it is the
  cutoff: `publish.yaml` sees `package.json` change, publishes to npm (trusted publishing,
  provenance) and creates the `vX.Y.Z` tag and GitHub Release with that section as notes.
- Hold a release by leaving the PR open. Set the repository variable `RELEASE_AUTOMERGE=true` to
  merge it automatically, and secret `RELEASE_TOKEN` (a PAT) if CI must run on the release PR. A
  version npm already holds (the accidental 3.0.0) is stepped past by patch.
  `node scripts/release.mjs next | notes X.Y.Z | check` work locally.
