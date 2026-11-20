import { describe, expect, it } from 'vitest';
import { waitingSessions, type SessionInfo } from '../agents/sessions/index.js';
import { SessionSendError } from '../agents/sessions/send.js';
import { createChatController } from './controller.js';
import { ago, canContinueHere, filterSessions, groupInOrder, resumeCommand } from './sessions.js';
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

  it('puts what waits for you first: approvals, then the newest', () => {
    const found = waitingSessions([
      session({ id: 'old', state: 'waiting', updatedAt: 1 }),
      session({ id: 'busy', state: 'active', updatedAt: 9 }),
      session({ id: 'asks', state: 'waiting', waitingFor: 'approval', updatedAt: 2 }),
      session({ id: 'new', state: 'waiting', waitingFor: 'reply', updatedAt: 5 }),
    ]);
    expect(ids(found)).toEqual(['asks', 'new', 'old']);
  });

  it('keeps that order across projects: the one with an approval first, though older', () => {
    const found = waitingSessions([
      session({ id: 'reply', cwd: '/work/new', state: 'waiting', updatedAt: 9 }),
      session({ id: 'asks', cwd: '/work/old', state: 'waiting', waitingFor: 'approval', updatedAt: 1 }),
    ]);
    expect(groupInOrder(found).map((project) => project.key)).toEqual(['/work/old', '/work/new']);
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

  it('accepts a session reply only with the token and a valid JSON prompt for the named source and id', async () => {
    const agent = { name: 'echo', command: process.execPath, capabilities: {}, run: () => undefined as never };
    const calls: unknown[][] = [];
    const controller = createChatController({ agents: [agent], cwd: '/w', env: {} });
    const ui = await startWebUi({
      controller,
      clientScript: '',
      title: { version: '1', cwd: '/w' },
      token: 'token',
      async sendPrompt(source, id, prompt, sandbox) {
        calls.push([source, id, prompt, sandbox]);
        if (id === 'busy') throw new SessionSendError('busy', 'private diagnostic');
        if (id === 'unexpected') throw new Error('private diagnostic');
        if (id === 'failed')
          return { ok: false, status: 'failed', exitCode: 1, signal: null, error: 'private diagnostic' };
        return { ok: true, status: 'completed', exitCode: 0, signal: null, text: 'Done.' };
      },
    });
    const post = (id: string, body: unknown, token = 'token', type = 'application/json') =>
      fetch(new URL('/api/sessions/echo/' + id + '/send', ui.url), {
        method: 'POST',
        headers: { 'content-type': type, 'x-genaicode-token': token },
        body: JSON.stringify(body),
      });
    try {
      expect((await post('id', { prompt: 'go' }, '')).status).toBe(403);
      expect((await post('id', { prompt: 'go' }, 'token', 'text/plain')).status).toBe(415);
      expect((await post('id', { prompt: ' ' })).status).toBe(400);
      expect((await post('id', { prompt: 'go', sandbox: 'unknown' })).status).toBe(400);
      expect(calls).toEqual([]);
      expect(await (await post('a%20b', { prompt: 'go', sandbox: 'read-only', cwd: '/different' })).json()).toEqual({
        ok: true,
        text: 'Done.',
      });
      expect(calls).toEqual([['echo', 'a b', 'go', 'read-only']]);
      const busy = await post('busy', { prompt: 'go' });
      expect(busy.status).toBe(409);
      expect(await busy.json()).toEqual({ error: 'A prompt is already running in this session.' });
      for (const [id, status] of [
        ['unexpected', 500],
        ['failed', 422],
      ] as const) {
        const response = await post(id, { prompt: 'go' });
        expect(response.status).toBe(status);
        expect(await response.text()).not.toContain('private diagnostic');
      }
    } finally {
      await ui.close();
      controller.close();
    }
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
