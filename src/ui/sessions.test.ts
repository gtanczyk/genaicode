import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '../agents/sessions/index.js';
import { createChatController } from './controller.js';
import { ago, canContinueHere, filterSessions, resumeCommand } from './sessions.js';
import { pageHtml } from './web/page.js';
import { startWebUi } from './web/server.js';

const session = (extra: Partial<SessionInfo>): SessionInfo => ({
  source: 'claude',
  agent: 'claude',
  id: 'aaaa',
  where: 'local',
  updatedAt: 1,
  ...extra,
});

describe('the Sessions view', () => {
  const sessions = [
    session({ id: 's1', title: 'CSV export', cwd: '/work/app', branch: 'feat/csv', state: 'waiting' }),
    session({ id: 's2', agent: 'codex', lastPrompt: 'Review the export', cwd: '/work/app', state: 'active' }),
    session({ id: 's3', firstPrompt: 'Fix flaky test', cwd: '/work/api', state: 'unfinished' }),
    session({ id: 's4', agent: 'muse', title: 'World builder', cwd: '/work/world' }),
  ];
  const ids = (found: SessionInfo[]) => found.map((item) => item.id);

  it('narrows by words, agent and state', () => {
    expect(ids(filterSessions(sessions, {}))).toEqual(['s1', 's2', 's3', 's4']);
    expect(ids(filterSessions(sessions, { text: 'EXPORT app' }))).toEqual(['s1', 's2']);
    expect(ids(filterSessions(sessions, { text: 'feat/csv' }))).toEqual(['s1']);
    expect(ids(filterSessions(sessions, { agent: 'codex' }))).toEqual(['s2']);
    expect(ids(filterSessions(sessions, { state: 'unfinished' }))).toEqual(['s3']);
    expect(ids(filterSessions(sessions, { text: 'export', state: 'active' }))).toEqual(['s2']);
    expect(ids(filterSessions(sessions, { text: 'nothing' }))).toEqual([]);
  });

  it('gives the command that continues a local session', () => {
    expect(resumeCommand(sessions[0]!)).toBe('genaicode chat -a claude -C /work/app -r s1');
    expect(resumeCommand(session({ id: 'x', cwd: "/work/it's here" }))).toBe(
      `genaicode chat -a claude -C '/work/it'\\''s here' -r x`,
    );
    expect(resumeCommand(session({ where: 'cloud', url: 'https://cursor.com/agents/bc-1' }))).toBeUndefined();
  });

  it('offers to continue here only readable sessions from the chat directory', () => {
    const here = (extra: Partial<SessionInfo>, cwd = '/work/app') =>
      canContinueHere(session({ cwd: '/work/app', ...extra }), cwd, ['claude']);
    expect(here({})).toBe(true);
    expect(here({ cwd: '/work/app/packages/web' }, '/work/app/')).toBe(true);
    expect(here({ cwd: '/work/application' })).toBe(false);
    expect(here({ cwd: '/work' })).toBe(false);
    expect(here({ source: 'muse', agent: 'muse' })).toBe(false);
    expect(here({ where: 'cloud' })).toBe(false);
    expect(here({ cwd: undefined })).toBe(false);
  });

  it('shows ages in the largest unit that fits', () => {
    expect([ago(0), ago(59 * 60_000), ago(3 * 3_600_000), ago(12 * 86_400_000)]).toEqual(['0m', '59m', '3h', '12d']);
  });

  it('is served only with the token, and only where the server lists sessions', async () => {
    const agent = { name: 'echo', command: process.execPath, capabilities: {}, run: () => undefined as never };
    const queries: Array<{ since?: number }> = [];
    const start = (withSessions: boolean) =>
      startWebUi({
        controller: createChatController({ agents: [agent], cwd: '/w', env: {} }),
        clientScript: '',
        title: { version: '1', cwd: '/w' },
        token: 't0k',
        ...(withSessions
          ? {
              sessions: async (query: { since?: number }) => {
                queries.push(query);
                return { sessions, errors: [{ source: 'muse', message: 'no sqlite' }] };
              },
            }
          : {}),
      });
    const ui = await start(true);
    const base = ui.url.replace(/\/\?.*$/, '');
    try {
      expect(await (await fetch(ui.url)).text()).toContain('data-sessions="1"');
      expect((await fetch(`${base}/api/sessions`)).status).toBe(403);
      const before = Date.now();
      const res = await fetch(`${base}/api/sessions?days=7`, { headers: { 'x-genaicode-token': 't0k' } });
      expect(res.status).toBe(200);
      const listing = (await res.json()) as { sessions: SessionInfo[]; errors: unknown[] };
      expect(ids(listing.sessions)).toEqual(['s1', 's2', 's3', 's4']);
      expect(listing.errors).toEqual([{ source: 'muse', message: 'no sqlite' }]);
      expect(queries[0]!.since).toBeGreaterThanOrEqual(before - 7 * 86_400_000);
      expect(queries[0]!.since).toBeLessThanOrEqual(Date.now() - 7 * 86_400_000);
      // No period, or a wrong one: everything.
      await fetch(`${base}/api/sessions?days=x`, { headers: { 'x-genaicode-token': 't0k' } });
      expect(queries[1]).toEqual({});
    } finally {
      await ui.close();
    }
    const plain = await start(false);
    try {
      expect(await (await fetch(plain.url)).text()).not.toContain('data-sessions');
      const res = await fetch(`${plain.url.replace(/\/\?.*$/, '')}/api/sessions`, {
        headers: { 'x-genaicode-token': 't0k' },
      });
      expect(res.status).toBe(404);
    } finally {
      await plain.close();
    }
    expect(pageHtml({ version: '1', cwd: '/w' })).not.toContain('data-sessions');
  });
});
