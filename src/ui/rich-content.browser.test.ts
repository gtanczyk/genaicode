import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentResult, AgentTask, CodingAgent } from '../agents/types.js';
import type { SessionInfo } from '../agents/sessions/index.js';
import { main, type UiLaunch } from '../cli/main.js';
import { runWeb } from './index.js';

// Minimal valid 1x1 transparent PNG.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

// Minimal valid 1-page PDF.
const TINY_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'utf8');

async function callMcp(task: AgentTask, serverName: string, toolName: string, args: Record<string, unknown>) {
  const server = task.mcpServers?.find((s) => s.name === serverName);
  if (!server || !('url' in server)) throw new Error(`Missing MCP server ${serverName}`);
  const res = await fetch(server.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...server.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: args } }),
  });
  const json = (await res.json()) as { result: { isError?: boolean; content: Array<{ text: string }> } };
  if (json.result.isError) throw new Error(json.result.content[0]?.text ?? 'MCP error');
  return json.result.content[0]?.text ?? '';
}

function makeAgent(
  name: string,
  handler: (task: AgentTask, emit: (event: AgentEvent) => void) => Promise<void>,
  extra?: Partial<CodingAgent>,
): CodingAgent {
  return {
    name,
    command: process.execPath,
    capabilities: { mcp: true, resume: true },
    ...extra,
    run(task) {
      const queue: AgentEvent[] = [];
      let wake: (() => void) | undefined;
      let done = false;
      const emit = (event: AgentEvent) => {
        queue.push(event);
        wake?.();
        wake = undefined;
      };
      const result = handler(task, emit)
        .then(
          (): AgentResult => ({
            status: task.signal?.aborted ? 'aborted' : 'completed',
            ok: !task.signal?.aborted,
            exitCode: 0,
            signal: null,
          }),
        )
        .catch(
          (error): AgentResult => ({
            status: task.signal?.aborted ? 'aborted' : 'failed',
            ok: false,
            exitCode: 1,
            signal: null,
            error: error instanceof Error ? error.message : String(error),
          }),
        )
        .finally(() => {
          done = true;
          wake?.();
          wake = undefined;
        });
      return {
        result,
        abort() {},
        async *[Symbol.asyncIterator]() {
          while (!done || queue.length) {
            if (!queue.length) {
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            }
            while (queue.length) yield queue.shift()!;
          }
          yield { type: 'done', result: await result };
        },
      };
    },
  };
}

let clientScript: string;

beforeAll(async () => {
  const bundle = await build({
    entryPoints: ['src/ui/web/client.tsx'],
    bundle: true,
    write: false,
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  clientScript = bundle.outputFiles[0]!.text;
}, 30_000);

describe('rich content in genaicode ui (browser)', () => {
  const cleanupDirs: string[] = [];
  afterAll(() => {
    for (const dir of cleanupDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('renders every viewer kind, line marks, multi-root session files, reveal, local thumbnails and click-to-load remote images', async () => {
    mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
    const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'rich-files-'));
    cleanupDirs.push(root);
    const home = join(root, 'home');
    const otherProject = join(root, 'other-project');
    const outside = join(root, 'outside');
    mkdirSync(home, { recursive: true });
    mkdirSync(otherProject, { recursive: true });
    mkdirSync(outside, { recursive: true });

    mkdirSync(join(home, 'docs'), { recursive: true });
    mkdirSync(join(otherProject, 'docs'), { recursive: true });
    writeFileSync(join(home, 'code.ts'), 'line1\nline2\nline3\nline4\nline5\n');
    writeFileSync(join(home, 'docs', 'doc.md'), '# Heading\n\nSome **bold** markdown.\n\n![Chart](./chart.png)\n');
    writeFileSync(join(home, 'docs', 'chart.png'), TINY_PNG);
    writeFileSync(join(home, 'shot.png'), TINY_PNG);
    writeFileSync(join(home, 'sound.mp3'), Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00'));
    writeFileSync(join(home, 'movie.webm'), Buffer.from('0123456789'));
    writeFileSync(join(home, 'sheet.pdf'), TINY_PDF);
    writeFileSync(join(home, 'demo.html'), '<!doctype html><h1>Sandboxed HTML</h1>');
    writeFileSync(join(home, 'archive.bin'), Buffer.from([0, 1, 2, 3]));
    writeFileSync(join(otherProject, 'from-session.ts'), 'export const fromSession = 42;\n');
    writeFileSync(join(otherProject, 'docs', 'report.md'), '# Secondary\n\n![Secondary chart](./chart.png)\n');
    // Distinct byte size so we can assert the secondary root's chart.png is served instead of home/docs/chart.png.
    const secondaryChart = Buffer.concat([TINY_PNG, Buffer.alloc(40)]);
    writeFileSync(join(otherProject, 'docs', 'chart.png'), secondaryChart);
    writeFileSync(join(outside, 'secret-outside.txt'), 'not in roots');

    // Remote image server to spy on requests.
    const remoteHits: string[] = [];
    const remoteServer = createServer((req, res) => {
      remoteHits.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(TINY_PNG.length) });
      res.end(TINY_PNG);
    });
    await new Promise<void>((resolve) => remoteServer.listen(0, '127.0.0.1', () => resolve()));
    const remotePort = (remoteServer.address() as AddressInfo).port;
    const remoteImgUrl = `http://127.0.0.1:${remotePort}/tracker.png?id=secret123`;

    const remoteSession: SessionInfo = {
      id: 'sess-other-1234',
      source: 'reader',
      agent: 'reader',
      where: 'local',
      cwd: otherProject,
      state: 'waiting',
      updatedAt: Date.now(),
    };
    const stderrChunks: string[] = [];
    const stderrStream = new PassThrough();
    stderrStream.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString('utf8')));
    const stdinStream = new PassThrough();
    const stop = new AbortController();

    const agent = makeAgent(
      'reader',
      async (task, emit) => {
        // Opening the other session via sessions_read adds otherProject to allowed roots!
        await callMcp(task, 'sessions', 'sessions_read', { id: remoteSession.id });
        emit({
          type: 'message',
          text: [
            `Files: [code](./code.ts#L3-L4) [md](./docs/doc.md) [img](./shot.png) [audio](./sound.mp3) [video](./movie.webm) [pdf](./sheet.pdf) [html](./demo.html) [bin](./archive.bin)`,
            `Other session: [from-session](${join(otherProject, 'from-session.ts')}) [secondary-md](./docs/report.md)`,
            `Outside: [outside](${join(outside, 'secret-outside.txt')})`,
            `![Local shot](./shot.png)`,
            `![Remote tracker](${remoteImgUrl})`,
          ].join('\n\n'),
        });
      },
      {
        sessions: {
          name: 'reader',
          where: 'local',
          list: async () => [remoteSession],
          read: async () => [],
        },
      },
    );

    const browser = await chromium.launch();
    let opened: string | undefined;
    let running: Promise<number> | undefined;
    try {
      const launch = (options: UiLaunch) =>
        runWeb({
          ...options,
          stdin: stdinStream as unknown as NodeJS.ReadStream,
          stderr: stderrStream,
          openUrl(url) {
            opened = url;
          },
          clientScript,
          firstPrompt: 'Show all content',
        });
      running = main({
        argv: ['ui', '--sessions', '--exit-with-stdin', '--no-open'],
        cwd: home,
        env: { GENAICODE_HOME: root, HOME: root },
        agents: [agent],
        signal: stop.signal,
        stdout: process.stdout,
        stderr: { write() {} },
        readStdin: async () => undefined,
        loadUi: async () => ({ runChat: launch, runWeb: launch }),
      });
      await vi.waitFor(() => {
        const line = stderrChunks.join('').match(/Open (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/);
        if (line) opened = line[1];
        expect(opened).toBeTruthy();
      });

      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const requestedRemote: string[] = [];
      page.on('request', (req) => {
        if (req.url().includes(`127.0.0.1:${remotePort}`)) requestedRemote.push(req.url());
      });
      await page.goto(opened!);

      // Local image thumbnail resolves automatically via /api/file/images!
      const thumb = page.locator('.gc-md-image-btn img.gc-md-image');
      await thumb.waitFor();
      expect(await thumb.getAttribute('src')).toMatch(/^\/files\/[0-9a-f]{32}$/);

      // Remote image chip is shown and ZERO requests were made to the remote server!
      const remoteChip = page.locator('.gc-md-image-chip');
      await remoteChip.waitFor();
      expect(await remoteChip.textContent()).toContain(`127.0.0.1:${remotePort}/tracker.png`);
      expect(requestedRemote).toEqual([]);
      expect(remoteHits).toEqual([]);

      // Clicking Load requests the remote image and renders it.
      await remoteChip.getByRole('button', { name: 'Load' }).click();
      await page.locator(`img.gc-md-image[src="${remoteImgUrl}"]`).waitFor();
      await vi.waitFor(() => expect(remoteHits).toEqual(['/tracker.png?id=secret123']));
      expect(requestedRemote).toEqual([remoteImgUrl]);

      // Clicking local thumbnail opens image viewer in panel, and clicking image toggles actual size.
      await page.locator('.gc-md-image-btn').click();
      const panel = page.locator('.viewer-panel');
      await panel.locator('.viewer-image-stage img').waitFor();
      await panel.locator('.viewer-image-stage img').click();
      expect(await panel.locator('.viewer-image-stage.actual').count()).toBe(1);

      // Text file with #L3-L4 marks lines 3 and 4!
      await page.locator('.gc-file-link', { hasText: 'code' }).click();
      await panel.locator('.file-text').waitFor();
      const markedLines = await panel
        .locator('.file-text span.file-line-mark')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-line')));
      expect(markedLines).toEqual(['3', '4']);

      // Markdown renders formatted HTML, resolves document-relative images not mentioned in chat, and toggles to Source.
      await page.locator('.gc-file-link', { hasText: /^md$/ }).click();
      await panel.locator('.viewer-markdown h2', { hasText: 'Heading' }).waitFor();
      const docImg = panel.locator('.viewer-markdown img.gc-md-image[alt="Chart"]');
      await docImg.waitFor();
      expect(await docImg.getAttribute('src')).toMatch(/^\/files\/[0-9a-f]{32}$/);
      await expect.poll(() => docImg.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      await panel.getByRole('button', { name: 'Source' }).click();
      await panel.locator('.file-text').waitFor();
      await panel.getByRole('button', { name: 'Preview' }).click();
      await panel.locator('.viewer-markdown .gc-md-image-btn').click();
      await panel.locator('.viewer-image-stage img').waitFor();
      expect(await panel.locator('.viewer-title').textContent()).toContain('docs/chart.png');

      // Audio viewer.
      await page.locator('.gc-file-link', { hasText: 'audio' }).click();
      await panel.locator('audio[controls]').waitFor();

      // Video viewer.
      await page.locator('.gc-file-link', { hasText: 'video' }).click();
      await panel.locator('video[controls]').waitFor();

      // PDF viewer.
      await page.locator('.gc-file-link', { hasText: 'pdf' }).click();
      const pdfFrame = panel.locator('iframe.viewer-frame');
      await pdfFrame.waitFor();
      expect(await pdfFrame.getAttribute('src')).toMatch(/^\/files\/[0-9a-f]{32}$/);

      // HTML viewer is sandboxed and toggles to Source.
      await page.locator('.gc-file-link', { hasText: 'html' }).click();
      const htmlFrame = panel.locator('iframe.viewer-frame[sandbox="allow-scripts"]');
      await htmlFrame.waitFor();
      await expect
        .poll(() => panel.frameLocator('iframe.viewer-frame[sandbox="allow-scripts"]').locator('h1').textContent())
        .toBe('Sandboxed HTML');
      await panel.getByRole('button', { name: 'Source' }).click();
      expect(await panel.locator('.file-text').textContent()).toContain('Sandboxed HTML');

      // Binary ("other") viewer shows MIME type and Download.
      await page.locator('.gc-file-link', { hasText: 'bin' }).click();
      await panel.locator('.viewer-fallback').waitFor();
      expect(await panel.locator('.viewer-fallback').textContent()).toContain('application/octet-stream');
      expect(await panel.locator('.viewer-fallback a[download]').count()).toBe(1);

      // File from the opened session's project root works!
      await page.locator('.gc-file-link', { hasText: 'from-session' }).click();
      await panel.locator('.file-text').waitFor();
      expect(await panel.locator('.file-text').textContent()).toContain('fromSession = 42');

      // Relative Markdown file in a secondary root keeps that root when resolving ./chart.png (even when home also has docs/chart.png).
      await page.locator('.gc-file-link', { hasText: 'secondary-md' }).click();
      await panel.locator('.viewer-markdown h2', { hasText: 'Secondary' }).waitFor();
      const secImg = panel.locator('.viewer-markdown img.gc-md-image[alt="Secondary chart"]');
      await secImg.waitFor();
      await panel.locator('.viewer-markdown .gc-md-image-btn').click();
      await panel.locator('.viewer-image-stage img').waitFor();
      expect(await panel.locator('header small').textContent()).toContain(`${secondaryChart.length} B`);

      // Outside file shows path + Reveal button in desktop (--exit-with-stdin) mode, and Reveal prints protocol line!
      await page.locator('.gc-file-link', { hasText: 'outside' }).click();
      await panel.locator('.viewer-refused-path').waitFor();
      expect(await panel.locator('.viewer-refused-path').textContent()).toContain('secret-outside.txt');
      await panel.locator('.viewer-actions button', { hasText: /Reveal/ }).click();
      await vi.waitFor(() => {
        expect(stderrChunks.join('')).toContain('Reveal ');
        expect(stderrChunks.join('')).toContain('secret-outside.txt');
      });
    } finally {
      stop.abort();
      stdinStream.end();
      await browser.close();
      await new Promise<void>((resolve) => remoteServer.close(() => resolve()));
      await running;
    }
  }, 45_000);

  it('opens artifacts in the side panel, updates in place on republish, confirms submit, honors Esc order and persists width', async () => {
    mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
    const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'rich-panel-'));
    cleanupDirs.push(root);
    const stop = new AbortController();

    let releaseRepublish!: () => void;
    const waitRepublish = new Promise<void>((resolve) => {
      releaseRepublish = resolve;
    });
    let releaseLongTurn!: () => void;
    let longTurnAborted = false;
    const receivedPrompts: string[] = [];

    const agent = makeAgent('builder', async (task, emit) => {
      receivedPrompts.push(task.prompt);
      if (receivedPrompts.length === 1) {
        await callMcp(task, 'artifacts', 'publish_artifact', {
          name: 'survey',
          title: 'Survey',
          format: 'html',
          content: '<!doctype html><div id="ver">Version 1</div>',
        });
        emit({ type: 'message', text: 'Published v1.' });
        await waitRepublish;
        await callMcp(task, 'artifacts', 'publish_artifact', {
          name: 'survey',
          title: 'Survey',
          format: 'html',
          content:
            '<!doctype html><div id="ver">Version 2</div>' +
            "<button id=\"go\" onclick=\"parent.postMessage({genaicode:'submit',data:{picked:'beta'}},'*')\">Send</button>",
        });
        emit({ type: 'message', text: 'Updated to v2.' });
        return;
      }
      if (task.prompt.includes('Submitted from the artifact')) {
        emit({ type: 'message', text: 'Got submission!' });
        // Hold this turn open so we can test the Esc order (full size -> panel -> stop agent).
        await new Promise<void>((resolve) => {
          releaseLongTurn = resolve;
          task.signal?.addEventListener(
            'abort',
            () => {
              longTurnAborted = true;
              resolve();
            },
            { once: true },
          );
        });
      }
    });

    const browser = await chromium.launch();
    let opened: string | undefined;
    let running: Promise<number> | undefined;
    try {
      const launch = (options: UiLaunch) =>
        runWeb({
          ...options,
          stderr: new PassThrough().resume(),
          openUrl(url) {
            opened = url;
          },
          clientScript,
          firstPrompt: 'Build survey',
        });
      running = main({
        argv: ['ui'],
        cwd: root,
        env: { GENAICODE_HOME: root, HOME: root },
        agents: [agent],
        signal: stop.signal,
        stdout: process.stdout,
        stderr: { write() {} },
        readStdin: async () => undefined,
        loadUi: async () => ({ runChat: launch, runWeb: launch }),
      });
      await vi.waitFor(() => expect(opened).toBeTruthy());

      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(opened!);

      // Wait for artifact card v1 and Artifacts list button.
      await page.getByRole('button', { name: 'Artifacts · 1' }).waitFor();
      await page.locator('.gc-artifact button', { hasText: 'Open' }).first().click();
      const panel = page.locator('.viewer-panel');
      await panel.waitFor();
      // Inline preview is NOT expanded in the card when side panel is used.
      expect(await page.locator('.gc-artifact iframe').count()).toBe(0);
      await expect
        .poll(() => panel.frameLocator('iframe.viewer-frame').locator('#ver').textContent())
        .toBe('Version 1');

      // Resize via keyboard on the separator and verify localStorage persistence.
      const sep = panel.locator('[role="separator"]');
      await sep.focus();
      await page.keyboard.press('ArrowLeft');
      const savedWidth = await page.evaluate(() => localStorage.getItem('genaicode-viewer-width'));
      expect(Number(savedWidth)).toBeGreaterThan(0);

      // Republish same artifact name -> open panel updates IN PLACE to v2 and shows version switcher!
      releaseRepublish();
      await expect
        .poll(() => panel.frameLocator('iframe.viewer-frame').locator('#ver').textContent())
        .toBe('Version 2');
      const versionSelect = panel.locator('select[aria-label="Version"]');
      await versionSelect.waitFor();

      // Switch to v1 and back to v2.
      await versionSelect.selectOption('1');
      await expect
        .poll(() => panel.frameLocator('iframe.viewer-frame').locator('#ver').textContent())
        .toBe('Version 1');
      await versionSelect.selectOption('2');
      await expect
        .poll(() => panel.frameLocator('iframe.viewer-frame').locator('#ver').textContent())
        .toBe('Version 2');

      // Submit from the iframe -> confirmation strip appears inside the panel -> Send to agent.
      await panel.frameLocator('iframe.viewer-frame').locator('#go').click();
      await panel.locator('.gc-artifact-submit').waitFor();
      expect(await panel.locator('.gc-artifact-submit-data').textContent()).toContain('"picked": "beta"');
      await panel.getByRole('button', { name: 'Send to agent' }).click();
      await page.getByText('Got submission!').waitFor();

      // Now turn 2 is STILL running. Put panel in Full size and verify Esc order:
      // 1st Esc -> exits Full size (panel stays open, agent keeps running)
      // 2nd Esc -> closes panel (agent keeps running)
      // 3rd Esc -> stops the running agent!
      await panel.getByRole('button', { name: 'Full size' }).click();
      expect(await panel.getAttribute('data-full-size')).toBe('true');

      await page.keyboard.press('Escape');
      expect(await panel.getAttribute('data-full-size')).toBeNull();
      expect(await panel.count()).toBe(1);
      expect(longTurnAborted).toBe(false);

      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'detached' });
      expect(longTurnAborted).toBe(false);

      // Focus the composer so chat's Esc stops the running turn.
      await page.locator('textarea[aria-label="Message"]').focus();
      await page.keyboard.press('Escape');
      await vi.waitFor(() => expect(longTurnAborted).toBe(true));

      // Header Artifacts button re-opens an artifact from earlier in the session.
      await page.getByRole('button', { name: 'Artifacts · 1' }).click();
      await page.locator('.artifacts-popover button', { hasText: 'Survey' }).click();
      await panel.waitFor();
    } finally {
      releaseRepublish?.();
      releaseLongTurn?.();
      stop.abort();
      await browser.close();
      await running;
    }
  }, 45_000);

  it('allows an HTML artifact to load a script from --artifact-cdn while blocking fetch exfiltration', async () => {
    mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
    const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'rich-cdn-'));
    cleanupDirs.push(root);
    const stop = new AbortController();

    const cdnHits: string[] = [];
    const cdnServer = createServer((req, res) => {
      cdnHits.push(req.url ?? '');
      if (req.url === '/lib.js') {
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
        res.end('window.__CDN_LOADED = "ok-from-cdn";');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('should-never-be-reached');
    });
    await new Promise<void>((resolve) => cdnServer.listen(0, '127.0.0.1', () => resolve()));
    const cdnPort = (cdnServer.address() as AddressInfo).port;
    const cdnOrigin = `http://127.0.0.1:${cdnPort}`;

    const agent = makeAgent('charts', async (task, emit) => {
      await callMcp(task, 'artifacts', 'publish_artifact', {
        name: 'cdn-test',
        title: 'CDN Test',
        format: 'html',
        content: `<!doctype html>
          <script src="${cdnOrigin}/lib.js"></script>
          <script>
            (async () => {
              let fetchBlocked = false;
              try {
                await fetch('${cdnOrigin}/exfil');
              } catch {
                fetchBlocked = true;
              }
              parent.postMessage({
                genaicode: 'submit',
                data: { loaded: window.__CDN_LOADED || null, fetchBlocked },
              }, '*');
            })();
          </script>`,
      });
      emit({ type: 'message', text: 'Chart ready.' });
    });

    const browser = await chromium.launch();
    let opened: string | undefined;
    let running: Promise<number> | undefined;
    try {
      const launch = (options: UiLaunch) =>
        runWeb({
          ...options,
          stderr: new PassThrough().resume(),
          openUrl(url) {
            opened = url;
          },
          clientScript,
          firstPrompt: 'Make a chart',
        });
      running = main({
        argv: ['ui', '--artifact-cdn', cdnOrigin],
        cwd: root,
        env: { GENAICODE_HOME: root, HOME: root },
        agents: [agent],
        signal: stop.signal,
        stdout: process.stdout,
        stderr: { write() {} },
        readStdin: async () => undefined,
        loadUi: async () => ({ runChat: launch, runWeb: launch }),
      });
      await vi.waitFor(() => expect(opened).toBeTruthy());

      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(opened!);
      await page.locator('.gc-artifact button', { hasText: 'Open' }).click();
      const panel = page.locator('.viewer-panel');
      await panel.locator('.gc-artifact-submit-data').waitFor();
      const submittedJson = JSON.parse((await panel.locator('.gc-artifact-submit-data').textContent()) ?? '{}') as {
        loaded: string | null;
        fetchBlocked: boolean;
      };
      expect(submittedJson).toEqual({ loaded: 'ok-from-cdn', fetchBlocked: true });
      expect(cdnHits).toContain('/lib.js');
      expect(cdnHits).not.toContain('/exfil');
    } finally {
      stop.abort();
      await browser.close();
      await new Promise<void>((resolve) => cdnServer.close(() => resolve()));
      await running;
    }
  }, 45_000);

  it('persists HTML artifact CDN settings from the desktop Settings popover and updates CSP live', async () => {
    mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
    const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'rich-settings-'));
    cleanupDirs.push(root);
    const stop = new AbortController();
    const stderrChunks: string[] = [];
    const stderrStream = new PassThrough();
    stderrStream.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString('utf8')));
    const stdinStream = new PassThrough();

    const agent = makeAgent('cfg', async (task, emit) => {
      await callMcp(task, 'artifacts', 'publish_artifact', {
        name: 'page',
        title: 'Page',
        format: 'html',
        content: '<!doctype html><h1>Hello</h1>',
      });
      emit({ type: 'message', text: 'Done.' });
    });

    const browser = await chromium.launch();
    let opened: string | undefined;
    let running: Promise<number> | undefined;
    try {
      const launch = (options: UiLaunch) =>
        runWeb({
          ...options,
          stdin: stdinStream as unknown as NodeJS.ReadStream,
          stderr: stderrStream,
          openUrl(url) {
            opened = url;
          },
          clientScript,
          firstPrompt: 'Make a page',
        });
      running = main({
        argv: ['ui', '--exit-with-stdin', '--no-open'],
        cwd: root,
        env: { GENAICODE_HOME: root, HOME: root },
        agents: [agent],
        signal: stop.signal,
        stdout: process.stdout,
        stderr: { write() {} },
        readStdin: async () => undefined,
        loadUi: async () => ({ runChat: launch, runWeb: launch }),
      });
      await vi.waitFor(() => {
        const match = stderrChunks.join('').match(/Open (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/);
        if (match) opened = match[1];
        expect(opened).toBeTruthy();
      });

      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(opened!);

      // Settings button appears in desktop (--exit-with-stdin) mode, off by default.
      await page.getByRole('button', { name: 'Settings' }).click();
      const dialog = page.getByRole('dialog', { name: 'Artifact network settings' });
      await dialog.waitFor();
      await dialog.locator('textarea').fill('cdn.jsdelivr.net');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await dialog.waitFor({ state: 'detached' });

      // Header reflects active CDN count and stderr emitted Settings protocol line.
      await page.getByRole('button', { name: 'Settings · CDN (1)' }).waitFor();
      await vi.waitFor(() => {
        expect(stderrChunks.join('')).toContain('Settings {"artifactCdn":["https://cdn.jsdelivr.net"]}');
      });

      // Reopening Settings preserves a partial preset host in the custom list so Save does not wipe it.
      await page.getByRole('button', { name: 'Settings · CDN (1)' }).click();
      await dialog.waitFor();
      expect(await dialog.locator('textarea').inputValue()).toBe('cdn.jsdelivr.net');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await dialog.waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Settings · CDN (1)' }).waitFor();

      // Artifact response now carries the live updated CSP header!
      const artifactHref = await page.locator('.gc-artifact a', { hasText: 'New tab' }).getAttribute('href');
      const origin = new URL(opened!).origin;
      const res = await fetch(`${origin}${artifactHref}`);
      expect(res.headers.get('content-security-policy')).toContain(
        "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
      );
    } finally {
      stop.abort();
      stdinStream.end();
      await browser.close();
      await running;
    }
  }, 45_000);

  it('resolves all streamed local images without losing in-flight batches and re-resolves expired capabilities', async () => {
    mkdirSync(join(process.cwd(), 'node_modules', '.genaicode-test'), { recursive: true });
    const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-test', 'rich-img-retry-'));
    cleanupDirs.push(root);
    writeFileSync(join(root, 'one.png'), TINY_PNG);
    writeFileSync(join(root, 'two.png'), TINY_PNG);

    const stop = new AbortController();
    let emitSecond!: () => void;
    const waitSecond = new Promise<void>((resolve) => {
      emitSecond = resolve;
    });

    const agent = makeAgent('streamer', async (_task, emit) => {
      emit({ type: 'text-delta', text: 'First: ![One](./one.png)\n\n' });
      await waitSecond;
      emit({ type: 'text-delta', text: 'Second: ![Two](./two.png)' });
    });

    const browser = await chromium.launch();
    let opened: string | undefined;
    let running: Promise<number> | undefined;
    try {
      const launch = (options: UiLaunch) =>
        runWeb({
          ...options,
          stderr: new PassThrough().resume(),
          openUrl(url) {
            opened = url;
          },
          clientScript,
          firstPrompt: 'Stream images',
        });
      running = main({
        argv: ['ui'],
        cwd: root,
        env: { GENAICODE_HOME: root, HOME: root },
        agents: [agent],
        signal: stop.signal,
        stdout: process.stdout,
        stderr: { write() {} },
        readStdin: async () => undefined,
        loadUi: async () => ({ runChat: launch, runWeb: launch }),
      });
      await vi.waitFor(() => expect(opened).toBeTruthy());

      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

      // Hold the first /api/file/images request until the second image streams into the reply.
      let releaseFirstBatch!: () => void;
      const firstBatchHeld = new Promise<void>((resolve) => {
        releaseFirstBatch = resolve;
      });
      let firstBatchSeen!: () => void;
      const waitFirstBatch = new Promise<void>((resolve) => {
        firstBatchSeen = resolve;
      });
      const imageRequests: string[][] = [];
      let expiredTwoOnce = false;

      await page.route('**/api/file/images', async (route) => {
        const body = route.request().postDataJSON() as { paths?: string[] };
        const paths = body.paths ?? [];
        imageRequests.push(paths);
        if (imageRequests.length === 1) {
          firstBatchSeen();
          await firstBatchHeld;
        }
        const upstream = await route.fetch();
        const json = (await upstream.json()) as { urls?: Record<string, string> };
        // On the initial resolution of ./two.png, return a stale capability URL so the <img> gets 404.
        if (paths.includes('./two.png') && !expiredTwoOnce && json.urls?.['./two.png']) {
          expiredTwoOnce = true;
          json.urls['./two.png'] = '/files/00000000000000000000000000000000';
        }
        await route.fulfill({ status: upstream.status(), contentType: 'application/json', body: JSON.stringify(json) });
      });

      await page.goto(opened!);

      // First image arrives and starts /api/file/images; stream the second image while batch 1 is still in flight.
      await waitFirstBatch;
      emitSecond();
      await vi.waitFor(() => expect(imageRequests.some((batch) => batch.includes('./two.png'))).toBe(true));
      // Now release batch 1: both One and Two must resolve, and Two must recover from its expired 404 capability.
      releaseFirstBatch();

      const oneImg = page.locator('img.gc-md-image[alt="One"]');
      const twoImg = page.locator('img.gc-md-image[alt="Two"]');
      await oneImg.waitFor();
      await twoImg.waitFor();
      await expect
        .poll(() =>
          Promise.all([
            oneImg.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
            twoImg.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
          ]),
        )
        .toEqual([true, true]);
      // Confirm ./two.png was re-requested after the expired capability failed.
      expect(imageRequests.filter((batch) => batch.includes('./two.png')).length).toBeGreaterThanOrEqual(2);
    } finally {
      stop.abort();
      await browser.close();
      await running;
    }
  }, 45_000);
});
