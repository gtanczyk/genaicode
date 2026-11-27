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
  const gallery = join(dir, 'camp gallery.md');
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
      created_at: '2026-01-05T10:00:00Z',
      content:
        '<USER_REQUEST>Show the camp.\nInclude the gallery.</USER_REQUEST>\n<ADDITIONAL_METADATA>Local time</ADDITIONAL_METADATA>',
    },
    {
      type: 'PLANNER_RESPONSE',
      tool_calls: [
        {
          name: 'update_steps',
          args: {
            steps: [
              { title: 'Inspect the camp', status: 'done' },
              { title: 'Render the gallery', status: 'in_progress' },
              { title: 'Check the final images', status: 'pending' },
            ],
          },
        },
      ],
    },
    { type: 'GENERIC', status: 'DONE' },
    {
      type: 'PLANNER_RESPONSE',
      content: 'The scene is ready.',
      tool_calls: Array.from({ length: 21 }, () => ({ name: 'read_file', args: { Path: 'camp.ts' } })),
    },
    ...Array.from({ length: 21 }, () => ({ type: 'GENERIC', status: 'DONE', content: 'file contents' })),
    {
      type: 'PLANNER_RESPONSE',
      tool_calls: [
        { name: 'update_focus', args: { focus: 'Rendering camp lighting and camera angles' } },
        { name: 'update_steps', args: { steps: [] } },
      ],
    },
    { type: 'GENERIC', status: 'DONE' },
    { type: 'GENERIC', status: 'ERROR', error: 'Update rejected' },
    {
      type: 'PLANNER_RESPONSE',
      created_at: '2026-01-05T10:09:40Z',
      content: `The tests passed. Open [gallery.md](${pathToFileURL(gallery)}) or [relative gallery](camp%20gallery.md) or [missing.md](./missing.md).`,
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
    const plan = detail.getByRole('list', { name: 'Plan' });
    await plan.locator('[aria-current="step"]').getByText('Render the gallery').waitFor();
    const work = detail.locator('.thread-work');
    expect(await work.count()).toBe(1);
    expect(await work.innerText()).not.toContain('read_file');
    const summary = work.locator('summary').first();
    expect(await summary.innerText()).toContain('Rendering camp lighting and camera angles · 9m 40s · 1 failed');
    await summary.click();
    await work.locator('details details').first().waitFor();
    expect(await work.locator('details details > summary').filter({hasText:/^read_file$/}).count()).toBe(21);
    await summary.click();
    await detail.getByRole('button', { name: 'gallery.md' }).click();
    await vi.waitFor(async () =>
      expect(
        await detail.getByRole('img', { name: 'Camp overview' }).evaluate((el: HTMLImageElement) => el.naturalWidth),
      ).toBe(1),
    );
    await detail.locator('.thread-document summary').click();
    await detail.getByRole('button', { name: 'relative gallery' }).click();
    await detail.getByRole('img', { name: 'Camp overview' }).waitFor();
    await detail.getByText('Recent session activity · the next reply is available when the session is idle').waitFor();
  } finally {
    await browser.close();
    await ui.close();
    rmSync(home, { recursive: true, force: true });
  }
}, 30000);
