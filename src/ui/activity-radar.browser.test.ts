import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import type { SessionInfo } from '../agents/sessions/types.js';
import { createChatController } from './controller.js';
import { loadAssets } from './index.js';
import { startWebUi } from './web/server.js';

it('follows a recorded link across agents, opens its transcript and returns to the radar', async () => {
  const now = Date.now();
  const row = (
    agent: string,
    id: string,
    title: string,
    minutes: number,
    patch: Partial<SessionInfo> = {},
  ): SessionInfo => ({
    agent,
    id,
    source: agent,
    title,
    where: 'local',
    cwd: '/work/catalog',
    updatedAt: now - minutes * 60_000,
    state: 'waiting',
    ...patch,
  });
  const sessions = [
    row('claude', 'filters', 'Catalog filters', 1, { turnInProgress: true, state: 'active' }),
    row('codex', 'review', 'Review filter changes', 3, { ending: 'question' }),
    row('antigravity', 'preview', 'Mobile catalog preview', 6),
    row('claude', 'search', 'Search results', 12),
    row('claude', 'layout', 'Catalog layout', 22),
    row('claude', 'icons', 'Icon contrast', 40),
    row('codex', 'billing', 'Billing export', 55, { cwd: '/work/billing' }),
  ];
  const bundle = await build({
    entryPoints: ['src/ui/web/client.tsx'],
    bundle: true,
    write: false,
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'text' },
  });
  const ui = await startWebUi({
    controller: createChatController({
      cwd: '/work/catalog',
      agents: [
        {
          name: 'claude',
          command: process.execPath,
          capabilities: {},
          run: () => {
            throw new Error('unexpected run');
          },
        },
      ],
      env: {},
    }),
    title: { cwd: '/work/catalog', version: 'test' },
    clientScript: bundle.outputFiles[0]!.text,
    assets: loadAssets(new URL('./web/assets/', import.meta.url)),
    sessions: async () => ({
      sessions,
      errors: [],
      readable: ['claude', 'codex', 'antigravity'],
      topics: [{ id: 'filters', name: 'Catalog filters' }],
      topicOf: { 'claude:filters': 'filters', 'codex:review': 'filters' },
    }),
    sessionTranscript: async (source, id) => {
      const session = sessions.find((s) => s.source === source && s.id === id);
      return (
        session && {
          session,
          readable: true,
          turns: [{ id: 1, agent: session.agent, startedAt: now, prompt: 'Review the catalog filters.', entries: [] }],
        }
      );
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 840 }, colorScheme: 'dark' });
    page.setDefaultTimeout(5000);
    await page.goto(ui.url);
    await page.getByRole('button', { name: 'All sessions', exact: true }).click();
    await page.getByRole('button', { name: 'Activity radar', exact: true }).click();
    const radar = page.getByRole('region', { name: 'Activity radar' });
    await radar.getByRole('group', { name: 'Threads of claude' }).waitFor();
    const detail = radar.getByRole('article', { name: 'Thread details' });
    expect(await detail.innerText()).toContain('Same topic · Catalog filters');
    expect(await detail.innerText()).not.toContain('Billing export');
    await radar.getByRole('button', { name: 'Thread links', exact: true }).click();
    await radar
      .getByRole('group', { name: 'Connected threads' })
      .getByRole('button', { name: /Review filter changes/ })
      .click();
    await detail.getByRole('heading', { name: 'Review filter changes' }).waitFor();
    await detail.getByRole('button', { name: 'Open transcript' }).click();
    await page.getByRole('main', { name: 'Session transcript' }).getByText('Review the catalog filters.').waitFor();
    await page.getByRole('button', { name: 'All sessions', exact: true }).last().click();
    await radar.getByRole('heading', { name: 'Review filter changes' }).waitFor();
    await page.getByRole('searchbox').fill('no-matching-thread');
    await page.getByText('No sessions match.').waitFor();
  } finally {
    await browser.close();
    await ui.close();
  }
}, 30_000);
