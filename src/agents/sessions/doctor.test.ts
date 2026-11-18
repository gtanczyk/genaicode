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
      'only 1 of the 6 newest sessions have a prompt or a title',
      'only 1 of the 6 newest sessions have a directory',
    ]);
    expect(check!.newer).toBe(true);
    expect(check!.notes.join('\n')).toContain('newer than the one checked (1.2.3)');
  });

  it('reports conversations that no longer open and a store that cannot be listed', async () => {
    const sessions = ['a', 'b', 'c'].map((id) => info(id, { lastPrompt: 'x', cwd: '/w' }));
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
    // An error's message may carry a path of the user's: its code, or the message without paths.
    const denied = source([], {
      name: 'denied',
      list: async () => {
        throw Object.assign(new Error("ENOENT: no such file, open '/Users/someone/.copilot/x/events.jsonl'"), {
          code: 'ENOENT',
        });
      },
    });
    const wordy = source([], {
      name: 'wordy',
      list: async () => {
        throw new Error('unable to open /Users/someone/.codex/state_5.sqlite today');
      },
    });
    const checks = await checkSessions([broken, silent, gone, denied, wordy], { env: env(), now: NOW });
    expect(checks[3]!.problems).toEqual(['cannot list: ENOENT']);
    expect(checks[4]!.problems).toEqual(['cannot list: unable to open <path> today']);
    expect(checks[0]!.problems).toEqual(['none of the 3 newest conversations could be read']);
    expect(checks[1]!.problems).toEqual(['no agent message in the 3 conversations read']);
    expect(checks[2]!.problems).toEqual(['cannot list: no such table: threads']);
  });

  it('judges prompts on the newest sessions and tries conversations the listing lost the prompt of', async () => {
    // Older sessions are listed without a prompt on purpose: only the newest are filled in.
    const many = Array.from({ length: 450 }, (_, at) =>
      info(`s${at}`, { cwd: '/w', updatedAt: NOW - at * 1000, ...(at < 200 ? { lastPrompt: 'p' } : {}) }),
    );
    const [big] = await checkSessions([source(many)], { env: env(), now: NOW });
    expect(big).toMatchObject({ listed: 450, withPrompt: 200, problems: [] });

    const unnamed = [info('a', { cwd: '/w' }), info('b', { cwd: '/w' })];
    const throwing = source(unnamed, {
      read: async () => {
        throw new Error('bad line');
      },
    });
    const empty = source(unnamed, { name: 'empty', read: async () => [] });
    const checks = await checkSessions([throwing, empty], { env: env(), now: NOW });
    expect(checks[0]).toMatchObject({ sampled: 2, problems: ['none of the 2 newest conversations could be read'] });
    expect(checks[1]!.problems).toEqual([]);
    expect(checks[1]!.notes[0]).toContain('or a store that changed');
    // One prompt nobody answered, or one conversation too long to find its prompt: healthy.
    const one = [info('a', { lastPrompt: 'x', cwd: '/w' })];
    const few = await checkSessions(
      [
        source(one, { name: 'unanswered', read: async () => [turn([])] }),
        source(one, { name: 'long', read: async () => [] }),
      ],
      { env: env(), now: NOW },
    );
    expect(few.map((check) => check.problems)).toEqual([[], []]);
    expect(few[0]!.notes[0]).toContain('not answered yet');
    expect(few[1]!.notes[0]).toContain('very long sessions');
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
