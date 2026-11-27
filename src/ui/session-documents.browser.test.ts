import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { it, expect, vi } from 'vitest';
import { antigravityTranscript } from '../agents/sessions/stores.js';
import type { SessionInfo } from '../agents/sessions/types.js';
import { sessionDocuments } from './session-documents.js';
import { createChatController } from './controller.js';
import { startWebUi } from './web/server.js';

it('opens a linked Antigravity gallery from a stored conversation and loads its image', async () => {
  const home = mkdtempSync(join(process.cwd(), 'node_modules', '.gallery-'));
  const dir = join(home, '.gemini', 'antigravity', 'brain', 'test-session');
  mkdirSync(dir, { recursive: true });
  const gallery = join(dir, 'gallery.md');
  writeFileSync(gallery, '# Camp gallery\n\n![Camp overview](./camp.png)');
  writeFileSync(
    join(dir, 'camp.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const session: SessionInfo = {
    source: 'antigravity',
    agent: 'antigravity',
    id: 'test-session',
    where: 'local',
    cwd: home,
    path: join(dir, '.system_generated', 'logs', 'transcript.jsonl'),
    updatedAt: Date.now(),
    state: 'active',
    title: 'Camp preview',
  };
  const turns = antigravityTranscript([
    {
      type: 'USER_INPUT',
      content:
        '<USER_REQUEST>Show the camp.\nInclude the gallery.</USER_REQUEST>\n<ADDITIONAL_METADATA>Local time</ADDITIONAL_METADATA>',
    },
    {
      type: 'PLANNER_RESPONSE',
      content: `The tests passed. Open [gallery.md](${pathToFileURL(gallery)}) or [missing.md](./missing.md).`,
    },
  ]);
  const bundle = await build({
    entryPoints: ['src/ui/web/client.tsx'],
    bundle: true,
    write: false,
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'text' },
  });
  const agent = { name: 'helper', command: process.execPath, capabilities: {}, run: () => undefined as never };
  const ui = await startWebUi({
    controller: createChatController({ cwd: home, agents: [agent], env: {} }),
    title: { cwd: home, version: 'test' },
    clientScript: bundle.outputFiles[0]!.text,
    sessions: async () => ({ sessions: [session], errors: [], readable: ['antigravity'] }),
    sessionTranscript: async () => ({ session, turns, readable: true }),
    sessionDocuments: sessionDocuments({ HOME: home }),
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(ui.url);
    await page.getByRole('button', { name: 'All sessions', exact: true }).click();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    const detail = page.getByRole('main', { name: 'Session transcript' });
    await detail.getByText('Show the camp. Include the gallery.').waitFor();
    expect(await detail.innerText()).not.toContain('ADDITIONAL_METADATA');
    expect(await detail.getByRole('button', { name: 'missing.md' }).count()).toBe(0);
    await detail.getByRole('button', { name: 'gallery.md' }).click();
    await vi.waitFor(async () =>
      expect(
        await detail.getByRole('img', { name: 'Camp overview' }).evaluate((el: HTMLImageElement) => el.naturalWidth),
      ).toBe(1),
    );
    await detail.getByText('Session active · replies are paused here').waitFor();
  } finally {
    await browser.close();
    await ui.close();
    rmSync(home, { recursive: true, force: true });
  }
}, 30000);
