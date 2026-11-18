import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionTurn } from '../session.js';
import { checkSessions, isNewer } from './doctor.js';
import type { SessionInfo, SessionSource } from './types.js';

const NOW = Date.UTC(2026, 10, 18);
const env = () => ({ HOME: mkdtempSync(join(tmpdir(), 'genaicode-doctor-')) });

function info(id: string, extra: Partial<SessionInfo> = {}): SessionInfo {
  return { source: 'fake', agent: 'fake', id, where: 'local', updatedAt: NOW - 1000, ...extra };
}

function turn(entries: SessionTurn['entries']): SessionTurn {
  return { id: 1, agent: 'fake', prompt: 'p', entries, startedAt: NOW };
}

function source(sessions: SessionInfo[], extra: Partial<SessionSource> = {}): SessionSource {
  return { name: 'fake', where: 'local', list: async () => sessions, ...extra };
}

describe('checkSessions', () => {
  it('counts what a healthy store gives and finds nothing wrong', async () => {
    const sessions = Array.from({ length: 6 }, (_, at) =>
      info(`s${at}`, { lastPrompt: 'do it', cwd: '/work', state: 'waiting' }),
    );
    const read = async () => [
      turn([
        { kind: 'text', text: 'done', streaming: false },
        { kind: 'tool', name: 'Bash', done: true },
      ]),
    ];
    const [check] = await checkSessions([source(sessions, { read, verified: '1.2.3' })], {
      env: env(),
      now: NOW,
      version: async () => '1.2.3',
    });
    expect(check).toMatchObject({
      listed: 6,
      withPrompt: 6,
      withCwd: 6,
      withState: 6,
      sampled: 5,
      read: 5,
      withReply: 5,
      withTools: 5,
      newer: false,
      problems: [],
    });
  });

  it('reports a store whose sessions lost their prompts, and the newer CLI behind it', async () => {
    const sessions = Array.from({ length: 6 }, (_, at) => info(`s${at}`, at ? {} : { title: 't', cwd: '/work' }));
    const [check] = await checkSessions([source(sessions, { verified: '1.2.3' })], {
      env: env(),
      now: NOW,
      version: async () => '1.3.0',
    });
    expect(check!.problems).toEqual([
      'only 1 of 6 sessions have a prompt or a title',
      'only 1 of 6 sessions have a directory',
    ]);
    expect(check!.newer).toBe(true);
    expect(check!.notes.join('\n')).toContain('newer than the one checked (1.2.3)');
  });

  it('reports conversations that no longer open and a store that cannot be listed', async () => {
    const sessions = [info('a', { lastPrompt: 'x', cwd: '/w' }), info('b', { lastPrompt: 'y', cwd: '/w' })];
    const broken = source(sessions, {
      read: async () => {
        throw new Error('bad line');
      },
    });
    const silent = source(sessions, { name: 'silent', read: async () => [turn([{ kind: 'input', text: 'hi' }])] });
    const gone = source([], {
      name: 'gone',
      list: async () => {
        throw new Error('no such table: threads');
      },
    });
    const checks = await checkSessions([broken, silent, gone], { env: env(), now: NOW });
    expect(checks[0]!.problems).toEqual(['none of the 2 newest conversations could be read']);
    expect(checks[1]!.problems).toEqual(['no agent message in the 2 conversations read']);
    expect(checks[2]!.problems).toEqual(['cannot list: no such table: threads']);
  });

  it('calls a few sessions without prompts and a list-only store fine', async () => {
    const [check] = await checkSessions([source([info('a'), info('b')])], { env: env(), now: NOW });
    expect(check!.problems).toEqual([]);
    expect(check!.notes).toEqual(['conversations cannot be read, only listed']);
  });
});

describe('isNewer', () => {
  it('compares versions number by number', () => {
    expect(isNewer('2.1.340', '2.1.327')).toBe(true);
    expect(isNewer('0.171.0', '0.170')).toBe(true);
    expect(isNewer('0.170.0', '0.170')).toBe(false);
    expect(isNewer('1.9', '1.10')).toBe(false);
  });
});
