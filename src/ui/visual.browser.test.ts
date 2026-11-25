/**
 * Visual baseline: screenshots of `<AgentChat>` and of the `genaicode ui` page, in both themes,
 * compared with the PNG files in `__screenshots__/<platform>/`.
 *
 * `agent-chat.css` ships to `genaicode/react` consumers, so a change to how the chat looks has to
 * be a decision, not a side effect. When a change is meant, update the baselines and commit them:
 *
 *   GENAICODE_UPDATE_SCREENSHOTS=1 npm run test:browser -- visual
 *
 * That rewrites the files of the platform it runs on. Text is drawn with the system font, which
 * differs between macOS and Linux, so each platform has its own directory. For the one you are
 * not on, take the files from CI: the `visual-screenshots` artifact of the `Lint and test` workflow holds
 * what the run drew (`<platform>/<name>.png`, with `<name>.diff.png` beside a mismatch); copy
 * the PNG files without `.diff` into `__screenshots__/<platform>/`. macOS and Linux must have
 * baselines (a missing one fails); on other platforms the comparison is skipped and says so.
 *
 * A pixel counts as different when a channel is off by more than CHANNEL_TOLERANCE; a screenshot
 * fails when more than MAX_DIFFERENT of its pixels are, or when its size changed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SessionState, SessionTurn } from '../agents/session.js';
import type { PackTask } from '../agents/pack.js';
import type { AgentEvent, AgentResult, CodingAgent } from '../agents/types.js';
import { main, type UiLaunch } from '../cli/main.js';
import { loadAssets, runWeb } from './index.js';

/** Rounding in a gradient or a blended edge moves a channel by one or two steps; a token change moves it by more. */
const CHANNEL_TOLERANCE = 2;
/** Share of the pixels that may differ: about 100 pixels of a 1000 × 1000 screenshot. */
const MAX_DIFFERENT = 0.0001;

const here = dirname(fileURLToPath(import.meta.url));
const baselineDir = join(here, '__screenshots__', process.platform);
/** What this run drew, for the CI artifact and for looking at a mismatch. Under node_modules, so git ignores it. */
const outputDir = join(process.cwd(), 'node_modules', '.genaicode-test', 'visual-screenshots', process.platform);
/** Only `1` rewrites baselines: `0`, `false` or any other value compares as usual. */
const update = process.env.GENAICODE_UPDATE_SCREENSHOTS === '1';
/** Platforms with committed baselines. On these a missing baseline fails; others are skipped and say so. */
const BASELINE_PLATFORMS: readonly string[] = ['darwin', 'linux'];
const compared = update || BASELINE_PLATFORMS.includes(process.platform);

/** The time every screenshot is taken at, so durations and relative times read the same in each run. */
const NOW = Date.parse('2026-10-06T10:00:00Z');
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

function compare(actual: Buffer, expected: Buffer): { different: number; total: number; diff?: Buffer; size?: string } {
  const a = PNG.sync.read(actual);
  const b = PNG.sync.read(expected);
  const total = b.width * b.height;
  if (a.width !== b.width || a.height !== b.height) {
    return { different: total, total, size: `${a.width}×${a.height}, baseline ${b.width}×${b.height}` };
  }
  const diff = new PNG({ width: a.width, height: a.height });
  let different = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let off = false;
    for (let c = 0; c < 4; c++) if (Math.abs(a.data[i + c]! - b.data[i + c]!) > CHANNEL_TOLERANCE) off = true;
    if (off) different++;
    // The mismatch in red over a faded copy of the screenshot.
    diff.data[i] = off ? 255 : 255 - (255 - a.data[i]!) / 4;
    diff.data[i + 1] = off ? 0 : 255 - (255 - a.data[i + 1]!) / 4;
    diff.data[i + 2] = off ? 0 : 255 - (255 - a.data[i + 2]!) / 4;
    diff.data[i + 3] = 255;
  }
  return { different, total, diff: different ? PNG.sync.write(diff) : undefined };
}

/** Takes the screenshot `name` and holds it against its baseline. */
async function expectScreenshot(target: Page | Locator, name: string, options: { mask?: Locator[] } = {}) {
  const actual = await target.screenshot({
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    mask: options.mask,
    maskColor: '#808080',
  });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, `${name}.png`), actual);
  rmSync(join(outputDir, `${name}.diff.png`), { force: true });
  const file = join(baselineDir, `${name}.png`);
  if (update) {
    mkdirSync(baselineDir, { recursive: true });
    // An unchanged screenshot keeps its file, so an update shows in git only where pixels moved.
    if (!existsSync(file) || compare(actual, readFileSync(file)).different) writeFileSync(file, actual);
    return;
  }
  if (!compared) return;
  if (!existsSync(file)) {
    throw new Error(`No baseline ${name}.png for ${process.platform}. Run with GENAICODE_UPDATE_SCREENSHOTS=1.`);
  }
  const result = compare(actual, readFileSync(file));
  if (result.diff) writeFileSync(join(outputDir, `${name}.diff.png`), result.diff);
  const share = result.different / result.total;
  if (result.size || share > MAX_DIFFERENT) {
    throw new Error(
      `Screenshot ${name} differs from its baseline: ${result.size ?? `${result.different} of ${result.total} pixels`}. ` +
        `See ${join(outputDir, name)}.png and .diff.png. If the change is meant, run with GENAICODE_UPDATE_SCREENSHOTS=1.`,
    );
  }
}

/** A page with a fixed size, clock, locale and time zone, no motion, in the given color scheme. */
async function newPage(browser: Browser, theme: Theme, viewport: { width: number; height: number }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: theme,
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  const page = await context.newPage();
  await page.clock.install({ time: NOW });
  await page.clock.setFixedTime(NOW);
  return page;
}

const settle = (page: Page) => page.evaluate(() => document.fonts.ready.then(() => undefined));

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
  if (!compared) {
    console.warn(
      `visual: ${process.platform} has no baselines; screenshots are written to ${outputDir} and not compared (skipped).`,
    );
  }
});
afterAll(() => browser?.close());

// ---------------------------------------------------------------------------------------------
// <AgentChat>
// ---------------------------------------------------------------------------------------------

const done: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null };

function session(patch: Partial<SessionState> = {}): SessionState {
  return {
    agent: 'claude',
    cwd: '/work/app',
    model: 'sonnet',
    sessionId: 'ses_0123456789abcdef',
    status: 'idle',
    canSteer: true,
    usage: { inputTokens: 18_400, outputTokens: 2_300 },
    costUsd: 0.12,
    queued: [],
    approvals: [],
    turns: [],
    ...patch,
  };
}

/** A finished turn: tools (one failed), an edit with a diff, a Markdown reply. */
const finishedTurn: SessionTurn = {
  id: 1,
  agent: 'claude',
  prompt: 'The build is red. Find out why and fix it.',
  startedAt: NOW - 600_000,
  endedAt: NOW - 558_000,
  result: done,
  entries: [
    { kind: 'tool', id: 't1', name: 'Bash', input: { command: 'npm run build' }, output: 'error TS2304', done: true },
    { kind: 'tool', id: 't2', name: 'Read', input: { file_path: '/work/app/src/cart.ts' }, output: '…', done: true },
    { kind: 'tool', id: 't3', name: 'mcp__ops__queue', input: {}, output: 'boom', isError: true, done: true },
    {
      kind: 'files',
      paths: ['/work/app/src/cart.ts'],
      diff: [
        'diff --git a/src/cart.ts b/src/cart.ts',
        '--- a/src/cart.ts',
        '+++ b/src/cart.ts',
        '@@ -1,4 +1,4 @@',
        ' export function total(items: Item[]) {',
        '-  return items.reduce((sum, item) => sum + item.price, 0);',
        '+  return items.reduce((sum, item) => sum + item.price * item.count, 0);',
        ' }',
      ].join('\n'),
    },
    {
      kind: 'text',
      streaming: false,
      text: [
        'The build failed on a **missing type**. Two changes:',
        '',
        '- `cart.ts` multiplies the price by the count',
        '- the type comes from [the docs](https://example.com/docs)',
        '',
        '| Check | Result |',
        '| ----- | ------ |',
        '| build | passes |',
        '| tests | 42 of 42 |',
        '',
        '```ts',
        'const sum = total(items);',
        '```',
      ].join('\n'),
    },
  ],
};

const tasks: PackTask[] = [
  {
    id: 't1',
    agent: 'codex',
    title: 'Cover the cart total',
    prompt: 'Write tests for total() in src/cart.ts.',
    mode: 'worktree',
    status: 'running',
    canSteer: true,
    cwd: '/work/app/.genaicode/worktrees/t1',
    text: 'Running the new tests',
    startedAt: NOW - 95_000,
  },
  {
    id: 't2',
    agent: 'gemini',
    title: 'Update the changelog',
    prompt: 'Add a changelog line for the cart fix.',
    mode: 'worktree',
    status: 'completed',
    state: 'unmerged',
    cwd: '/work/app/.genaicode/worktrees/t2',
    text: 'Added one line under Unreleased.',
    changes: ['M\tdocs/CHANGELOG.md'],
    startedAt: NOW - 200_000,
    endedAt: NOW - 150_000,
  },
  {
    id: 't3',
    agent: 'codex',
    title: 'Check the checkout page',
    prompt: 'Open the checkout page and compare the total.',
    mode: 'shared',
    status: 'failed',
    cwd: '/work/app',
    error: 'The dev server did not start.',
    startedAt: NOW - 180_000,
    endedAt: NOW - 170_000,
  },
];

/** A turn at work: a plan, tools done and running, input sent meanwhile, three delegated tasks. */
const runningTurn: SessionTurn = {
  id: 2,
  agent: 'claude',
  prompt: 'Now add tests and a changelog line. Delegate what you can.',
  startedAt: NOW - 215_000,
  pack: { lead: 'claude', maxParallel: 3, tasks, interactive: true },
  entries: [
    {
      kind: 'progress',
      message: 'Handing out the work',
      plan: [
        { step: 'Split the work', status: 'completed' },
        { step: 'Wait for the tasks', status: 'in_progress' },
        { step: 'Merge and report', status: 'pending' },
      ],
    },
    { kind: 'tool', id: 't4', name: 'Bash', input: { command: 'git status --short' }, output: '', done: true },
    { kind: 'input', text: 'Keep the changelog line short.', delivery: 'delivered' },
    { kind: 'tool', id: 't5', name: 'Bash', input: { command: 'npm test -- cart' }, done: false },
    { kind: 'text', text: 'Three tasks are out; one is still running', streaming: true },
  ],
};

/** A turn waiting for the person: a command to approve and a question to answer. */
const askingTurn: SessionTurn = {
  id: 2,
  agent: 'claude',
  prompt: 'Clean the build output and release.',
  startedAt: NOW - 30_000,
  entries: [
    { kind: 'text', text: 'The old build output has to go first.', streaming: false },
    { kind: 'approval', request: { id: 'ap-0', kind: 'command', summary: 'npm run lint' }, decision: 'approve' },
    { kind: 'approval', request: { id: 'ap-1', kind: 'command', summary: 'rm -rf dist' } },
    {
      kind: 'approval',
      request: {
        id: 'q-1',
        kind: 'question',
        questions: [
          {
            id: 'bump',
            header: 'Version',
            question: 'Which version should this release be?',
            options: [
              { label: 'Patch', description: 'Fixes only: 3.3.1' },
              { label: 'Minor', description: 'New features: 3.4.0' },
            ],
          },
        ],
      },
    },
  ],
};

const chatStates: Record<string, { state: SessionState; height: number }> = {
  empty: { state: session({ sessionId: undefined, usage: {}, costUsd: undefined }), height: 600 },
  running: {
    state: session({
      status: 'running',
      turns: [finishedTurn, runningTurn],
      queued: ['Then open a pull request.'],
    }),
    height: 1700,
  },
  approvals: {
    state: session({
      status: 'running',
      turns: [askingTurn],
      approvals: askingTurn.entries.flatMap((entry) =>
        entry.kind === 'approval' && !entry.decision ? [entry.request] : [],
      ),
    }),
    height: 900,
  },
};

/** The component and its stylesheet as a consumer of `genaicode/react` gets them. */
async function bundleChat() {
  const bundle = await build({
    stdin: {
      resolveDir: here,
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client';
        import { AgentChat } from '../react.js';
        import styles from '../react/agent-chat.css';
        document.head.appendChild(document.createElement('style')).textContent = styles;
        const noop = () => undefined;
        window.renderChat = (props) =>
          createRoot(document.getElementById('root')).render(
            <AgentChat
              onSend={noop}
              onStop={noop}
              onApprove={noop}
              onAnswer={noop}
              onAutoApprove={noop}
              onPackAction={async () => ''}
              onOpenFile={noop}
              {...props}
            />,
          );
      `,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  return bundle.outputFiles[0]!.text;
}

describe('<AgentChat> looks as its baseline', () => {
  let script: string;
  beforeAll(async () => {
    script = await bundleChat();
  });

  for (const [name, { state, height }] of Object.entries(chatStates)) {
    for (const theme of THEMES) {
      it(`${name}, ${theme}`, async () => {
        // The other color scheme than the theme prop asks for: the prop has to win.
        const page = await newPage(browser, theme === 'dark' ? 'light' : 'dark', { width: 900, height });
        try {
          await page.setContent(
            '<!doctype html><html><body style="margin:0"><div id="root" style="height:100vh"></div></body></html>',
          );
          await page.addScriptTag({ content: script });
          await page.evaluate((props) => (window as unknown as { renderChat(p: unknown): void }).renderChat(props), {
            state,
            theme,
          });
          await page.locator('.gc-chat').waitFor();
          await settle(page);
          await expectScreenshot(page, `chat-${name}-${theme}`);
        } finally {
          await page.context().close();
        }
      });
    }
  }

  // The design tokens of docs/design/desktop-layout.md are there beside the chat's own variables,
  // in both themes, and the one variable that already reads a token resolves to it.
  it('defines the design tokens for both themes', async () => {
    const page = await newPage(browser, 'light', { width: 900, height: 600 });
    try {
      await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
      await page.addScriptTag({ content: script });
      const read = async (theme: Theme) => {
        await page.evaluate((props) => (window as unknown as { renderChat(p: unknown): void }).renderChat(props), {
          state: chatStates.empty!.state,
          theme,
        });
        await page.locator(`.gc-chat[data-theme="${theme}"]`).waitFor();
        return page.evaluate(() => {
          const style = getComputedStyle(document.querySelector('.gc-chat')!);
          const value = (name: string) => style.getPropertyValue(name).trim();
          const names = [
            ...['bg', 'surface', 'text', 'muted', 'accent', 'run', 'merge'].map((name) => `--gc-color-${name}`),
            ...['type-11', 'type-24', 'space-1', 'space-8', 'radius-control', 'radius-card'].map((n) => `--gc-${n}`),
            '--gc-elevation-2',
            '--gc-font-mono',
            '--_mono',
          ];
          return Object.fromEntries(names.map((name) => [name, value(name)]));
        });
      };
      const light = await read('light');
      expect(light).toMatchObject({
        '--gc-color-bg': '#fbfaf7',
        '--gc-color-surface': '#ffffff',
        '--gc-color-text': '#1e1c19',
        '--gc-color-muted': '#57524a',
        '--gc-color-accent': '#a04a14',
        '--gc-color-run': '#2757b8',
        '--gc-color-merge': '#6a3fb5',
        '--gc-type-11': '11px',
        '--gc-type-24': '24px',
        '--gc-space-1': '4px',
        '--gc-space-8': '32px',
        '--gc-radius-control': '8px',
        '--gc-radius-card': '12px',
      });
      expect(light['--gc-elevation-2']).toContain('rgba(30, 28, 25');
      // The alias: the chat's mono font is the token's value.
      expect(light['--_mono']).toBe(light['--gc-font-mono']);
      expect(light['--gc-font-mono']).toContain('ui-monospace');

      const dark = await read('dark');
      expect(dark).toMatchObject({
        '--gc-color-bg': '#1a1917',
        '--gc-color-surface': '#222120',
        '--gc-color-text': '#ece9e3',
        '--gc-color-muted': '#b9b3a8',
        '--gc-color-accent': '#e8935a',
        '--gc-color-run': '#8fb1f4',
        '--gc-color-merge': '#bda7f3',
        '--gc-type-11': '11px',
        '--gc-radius-card': '12px',
      });
      expect(dark['--gc-elevation-2']).toContain('rgba(0, 0, 0');

      // Without the theme prop the tokens follow the color scheme, on the page as in the chat.
      const auto = async (scheme: Theme) => {
        await page.emulateMedia({ colorScheme: scheme });
        return page.evaluate(() =>
          [document.documentElement, document.querySelector('.gc-chat')!].map((element) =>
            getComputedStyle(element).getPropertyValue('--gc-color-bg').trim(),
          ),
        );
      };
      await page.evaluate((props) => (window as unknown as { renderChat(p: unknown): void }).renderChat(props), {
        state: chatStates.empty!.state,
      });
      await page.locator('.gc-chat:not([data-theme])').waitFor();
      expect(await auto('light')).toEqual(['#fbfaf7', '#fbfaf7']);
      expect(await auto('dark')).toEqual(['#1a1917', '#1a1917']);
    } finally {
      await page.context().close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The `genaicode ui` page
// ---------------------------------------------------------------------------------------------

describe('the genaicode ui page looks as its baseline', () => {
  const stop = new AbortController();
  let root: string;
  let project: string;
  let running: Promise<number> | undefined;
  let url: string | undefined;
  /** Ends the turn that delegates, which otherwise stays at work. */
  let release: (() => void) | undefined;
  /** The tasks of that turn: one running, one with changes to merge and an agent to review them, one failed. */
  const delegated = tasks.map((task) => (task.id === 't2' ? { ...task, checks: { reviewer: 'helper' } } : task));

  /**
   * Puts fixed words where the page shows what differs between runs and releases: the directory of
   * this checkout and the version. The elements keep their styles; only the letters change.
   */
  const steady = (page: Page) =>
    page.evaluate(
      ([directory, name]) => {
        const version = document.getElementById('root')!.dataset.version!;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.nodeValue ?? '';
          const fixed = text.split(directory!).join(name!).split(version).join('0.0.0');
          if (fixed !== text) node.nodeValue = fixed;
        }
      },
      [project, '/work/app'],
    );

  beforeAll(async () => {
    // Outside os.tmpdir(), as in the other page tests; HOME is its parent, so the page shows `~/app`.
    mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
    root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'visual-'));
    project = join(root, 'app');
    mkdirSync(project);
    // A repository of its own on a fixed branch: the new chat's project line names the branch, and
    // without this it would be the branch of whatever checkout runs the test (none in a CI merge).
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project });
    const reply = 'The cart total now counts **every item**:\n\n- `cart.ts` multiplies the price by the count';
    const helper: CodingAgent = {
      name: 'helper',
      command: process.execPath,
      capabilities: { mcp: true, resume: true, approvals: true },
      run(task) {
        const result: AgentResult = { ...done, sessionId: 'ses_0123456789abcdef', text: reply };
        // A prompt that asks to delegate gets a turn that stays at work, with three delegated tasks.
        if (/Delegate/.test(task.prompt)) {
          const released = new Promise<void>((resolve) => (release = resolve));
          return {
            result: released.then(() => result),
            abort: () => release?.(),
            pack: {
              lead: 'helper',
              maxParallel: 3,
              task: (id) => delegated.find((item) => item.id === id),
              act: async () => '',
            },
            async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
              yield { type: 'session', sessionId: result.sessionId! };
              for (const item of delegated) yield { type: 'subtask-start', ...item };
              yield { type: 'message', text: 'Three tasks are out; one is still running.' };
              await released;
              yield { type: 'done', result };
            },
          };
        }
        return {
          result: Promise.resolve(result),
          abort() {},
          async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
            yield { type: 'session', sessionId: result.sessionId! };
            yield { type: 'message', text: reply };
            yield { type: 'done', result };
          },
        };
      },
    };
    const bundle = await build({
      entryPoints: ['src/ui/web/client.tsx'],
      bundle: true,
      write: false,
      platform: 'browser',
      jsx: 'automatic',
      loader: { '.css': 'text' },
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    const launch = (options: UiLaunch) =>
      runWeb({
        ...options,
        stderr: new PassThrough().resume(),
        openUrl(opened) {
          url = opened;
        },
        clientScript: bundle.outputFiles[0]!.text,
        // The mascot, which a built package serves from beside its bundle.
        assets: loadAssets(new URL('./web/assets/', import.meta.url)),
      });
    running = main({
      argv: ['ui', '--no-artifacts'],
      cwd: project,
      env: { GENAICODE_HOME: join(root, '.genaicode'), HOME: root },
      agents: [helper],
      signal: stop.signal,
      stdout: process.stdout,
      stderr: { write() {} },
      readStdin: async () => undefined,
      loadUi: async () => ({ runChat: launch, runWeb: launch }),
    });
    await vi.waitFor(() => expect(url).toBeTruthy());
  });
  afterAll(async () => {
    release?.();
    stop.abort();
    await running;
    if (root) rmSync(root, { recursive: true, force: true });
  });

  // One server and one conversation: the start page in both themes first, then a turn, then both
  // again, then Search open over it.
  it('start page, a finished turn and Search, light and dark', async () => {
    const pages = await Promise.all(THEMES.map((theme) => newPage(browser, theme, { width: 1280, height: 800 })));
    try {
      for (const page of pages) {
        await page.goto(url!);
        await page.locator('.gc-chat textarea').waitFor();
      }
      // How long the turn took differs between runs.
      const mask = (page: Page) => [page.locator('.gc-turn-footer')];
      // All of them are drawn before the test fails, so one CI run's artifact holds every new baseline.
      const differing: string[] = [];
      const shot = (page: Page, name: string) =>
        expectScreenshot(page, name, { mask: mask(page) }).catch((error: unknown) => {
          differing.push(error instanceof Error ? error.message : String(error));
        });
      for (const [index, page] of pages.entries()) {
        // The sidebar's last piece: Help, where What's new is.
        await page.getByRole('button', { name: 'Help', exact: true }).waitFor();
        // The project line gets the folder's branch from the server after the page is up.
        await page.locator('.gc-composer-header', { hasText: 'main' }).waitFor();
        // The mascot is a background image: drawn only once it has loaded.
        await page.evaluate(() =>
          Promise.all(
            ['/assets/wolf-64.png', '/assets/wolf.webp', '/assets/wolf-dark.webp'].map((src) =>
              Object.assign(new Image(), { src }).decode(),
            ),
          ),
        );
        await steady(page);
        await settle(page);
        await shot(page, `page-start-${THEMES[index]}`);
      }
      await pages[0]!.locator('.gc-chat textarea').fill('Why is the cart total wrong?');
      await pages[0]!.keyboard.press('Enter');
      for (const [index, page] of pages.entries()) {
        await page.locator('.gc-turn-footer').waitFor();
        await page.locator('.gc-chat[data-status="idle"]').waitFor();
        await steady(page);
        await settle(page);
        await shot(page, `page-turn-${THEMES[index]}`);
      }
      // Search over the page: the chat, then the commands, the first row selected.
      for (const [index, page] of pages.entries()) {
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
        await page.getByRole('dialog', { name: 'Search chats and sessions' }).waitFor();
        await page.getByRole('option', { name: /Why is the cart total wrong/ }).waitFor();
        // How long the turn took shows beside the palette: hidden here, as a mask would cover the palette too.
        await page.addStyleTag({ content: '.gc-turn-footer { visibility: hidden; }' });
        await steady(page);
        await settle(page);
        await expectScreenshot(page, `page-palette-${THEMES[index]}`).catch((error: unknown) => {
          differing.push(error instanceof Error ? error.message : String(error));
        });
      }
      expect(differing).toEqual([]);
    } finally {
      await Promise.all(pages.map((page) => page.context().close()));
    }
  });
  // The same conversation, after the turn above: a turn that delegates, with the work panel beside the chat.
  it("work panel with delegated tasks and one task's detail, light and dark", async () => {
    const pages = await Promise.all(THEMES.map((theme) => newPage(browser, theme, { width: 1280, height: 800 })));
    try {
      for (const page of pages) {
        await page.goto(url!);
        await page.locator('.gc-chat textarea').waitFor();
      }
      // How long the turns took, and how long the one at work has run, differ between runs.
      const mask = (page: Page) => [page.locator('.gc-turn-footer'), page.locator('.gc-working')];
      const differing: string[] = [];
      const shot = (page: Page, name: string) =>
        expectScreenshot(page, name, { mask: mask(page) }).catch((error: unknown) => {
          differing.push(error instanceof Error ? error.message : String(error));
        });
      await pages[0]!.locator('.gc-chat textarea').fill('Now add tests and a changelog line. Delegate what you can.');
      await pages[0]!.keyboard.press('Enter');
      for (const [index, page] of pages.entries()) {
        // At 1280 px the panel opens by itself beside the chat, which keeps 600 px.
        const work = page.getByRole('complementary', { name: 'Work panel' });
        await work.locator('[data-task$=":t3"]').waitFor();
        await page.locator('.gc-workline').waitFor();
        await steady(page);
        await settle(page);
        await shot(page, `page-work-${THEMES[index]}`);
        // A task with changes to merge: what it was asked, its result, the checks and what Merge locally does.
        await work.locator('[data-task$=":t2"] .gc-work-row').click();
        await work.getByRole('button', { name: 'Merge locally' }).waitFor();
        // The pointer rests on nothing.
        await page.mouse.move(0, 0);
        await steady(page);
        await settle(page);
        await shot(page, `page-task-${THEMES[index]}`);
      }
      expect(differing).toEqual([]);
    } finally {
      release?.();
      await Promise.all(pages.map((page) => page.context().close()));
    }
  });

  // The Settings page in the shell: its first section, and About (the version reads 0.0.0).
  it('settings page, light and dark', async () => {
    const pages = await Promise.all(THEMES.map((theme) => newPage(browser, theme, { width: 1280, height: 800 })));
    try {
      const differing: string[] = [];
      const shot = (page: Page, name: string) =>
        expectScreenshot(page, name).catch((error: unknown) => {
          differing.push(error instanceof Error ? error.message : String(error));
        });
      for (const [index, page] of pages.entries()) {
        await page.goto(url!);
        await page.locator('.gc-chat textarea').waitFor();
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        const settings = page.getByRole('main', { name: 'Settings' });
        // The bark's switch comes with the first view from the server.
        await settings.getByRole('switch', { name: 'Bark when an agent needs you' }).waitFor();
        await page.evaluate(() => Object.assign(new Image(), { src: '/assets/wolf-64.png' }).decode());
        await steady(page);
        await settle(page);
        await shot(page, `page-settings-${THEMES[index]}`);
        await settings.getByRole('button', { name: 'About and updates', exact: true }).click();
        await settings.getByRole('link', { name: 'Get help' }).waitFor();
        await steady(page);
        await settle(page);
        await shot(page, `page-settings-about-${THEMES[index]}`);
      }
      expect(differing).toEqual([]);
    } finally {
      await Promise.all(pages.map((page) => page.context().close()));
    }
  });
});
