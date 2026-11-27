import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT_OK, main as runCli } from '../../cli/main.js';
import { recordHook } from './live.js';
import type { SessionInfo } from './types.js';
import { withBriefing } from '../host-text.js';
import { delegationBrief } from '../pack.js';
import {
  claudeSessions,
  codexSessions,
  groupSessions,
  listSessions,
  replyEnding,
  type SessionSource,
} from './index.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-sessions-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const lines = (...values: unknown[]) => values.map((value) => JSON.stringify(value)).join('\n') + '\n';

/** Write a file last modified `minutesAgo`. */
function file(path: string, content: string, minutesAgo: number): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  const at = new Date(Date.now() - minutesAgo * 60_000);
  utimesSync(path, at, at);
}

const claudeDir = join(root, 'claude');
const user = (text: unknown, extra: object = {}) => ({
  type: 'user',
  cwd: '/work/app',
  gitBranch: 'feat/csv',
  timestamp: '2026-11-01T10:00:00.000Z',
  message: { role: 'user', content: text },
  ...extra,
});
const assistant = (content: unknown[]) => ({
  type: 'assistant',
  cwd: '/work/app/src',
  message: { role: 'assistant', model: 'claude-sonnet-5', content },
});

file(
  join(claudeDir, 'projects', '-work-app', 'aaaa.jsonl'),
  lines(
    user('<command-name>/model</command-name>'),
    user('Add CSV export\nwith tests'),
    assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]),
    user([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
    assistant([{ type: 'text', text: 'Done: export works.' }]),
    user('Now document it'),
    { ...assistant([{ type: 'text', text: 'Documented in README.' }]), timestamp: '2026-11-01T10:03:00Z' },
    { type: 'ai-title', aiTitle: 'CSV export' },
    { type: 'cost-state', totalCostUSD: 1.25 },
  ),
  30,
);
// Stops in the middle of the agent's work.
file(
  join(claudeDir, 'projects', '-work-app', 'bbbb.jsonl'),
  lines(user('Fix the flaky test'), assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }])),
  600,
);
// A subagent transcript and a file with no conversation are not sessions.
file(join(claudeDir, 'projects', '-work-app', 'aaaa', 'subagents', 'agent-1.jsonl'), lines(user('sub')), 5);
file(join(claudeDir, 'projects', '-work-app', 'cccc.jsonl'), lines({ type: 'mode', mode: 'normal' }), 5);
file(join(claudeDir, 'projects', '-work-other', 'dddd.jsonl'), lines(user('Just started', { cwd: '/work/other' })), 0);

const codexDir = join(root, 'codex');
const rollout = (id: string) =>
  join(codexDir, 'sessions', '2026', '11', '02', `rollout-2026-11-02T09-00-00-${id}.jsonl`);
const ID = '01234567-89ab-cdef-0123-456789abcdef';
file(
  rollout(ID),
  lines(
    {
      type: 'session_meta',
      payload: { id: ID, cwd: '/work/app', timestamp: '2026-11-02T09:00:00Z', git: { branch: 'main' } },
    },
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }],
      },
    },
    { type: 'turn_context', payload: { cwd: '/work/app', model: 'gpt-5.5-codex' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Review the CSV export' } },
    {
      type: 'event_msg',
      timestamp: '2026-11-02T09:15:00Z',
      payload: { type: 'agent_message', message: 'Two issues found.' },
    },
    {
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 900, output_tokens: 100, total_tokens: 1000 } },
      },
    },
    { type: 'event_msg', payload: { type: 'task_complete' } },
  ),
  90,
);
// A helper thread another session started is not a session of the user's.
file(
  rollout('99999999-89ab-cdef-0123-456789abcdef'),
  lines(
    { type: 'session_meta', payload: { cwd: '/work/app', source: { subagent: { thread_spawn: { depth: 1 } } } } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Look up the parser' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'Found it.' } },
  ),
  80,
);

describe('session sources', () => {
  it('keeps a title from the start of a long Claude Code transcript', async () => {
    const dir = join(root, 'claude-long');
    const filler = Array.from({ length: 700 }, () => assistant([{ type: 'text', text: 'x'.repeat(1000) }]));
    file(
      join(dir, 'projects', '-work-app', 'eeee.jsonl'),
      lines(user('Plan the release'), { type: 'custom-title', customTitle: 'Release plan' }, ...filler),
      30,
    );
    const [session] = await claudeSessions({ dir }).list();
    expect(session).toMatchObject({ title: 'Release plan', firstPrompt: 'Plan the release' });
  });

  it('names a session after the person, not a briefing genaicode put in its first message', async () => {
    const dir = join(root, 'claude-briefed');
    const brief = delegationBrief([{ name: 'codex', installed: true, running: 0, steer: false }]);
    const done = assistant([{ type: 'text', text: 'Done.' }]);
    file(
      join(dir, 'projects', '-work-app', 'old.jsonl'),
      lines(user(`${brief}\n\nMake the header calm`), done, { type: 'ai-title', aiTitle: 'Coding agents via pack' }),
      30,
    );
    file(
      join(dir, 'projects', '-work-app', 'named.jsonl'),
      lines(user(`${brief}\n\nFix the title`), done, { type: 'custom-title', customTitle: 'Title fix' }),
      40,
    );
    file(
      join(dir, 'projects', '-work-app', 'tagged.jsonl'),
      lines(user(withBriefing('Review the diff', brief)), done, { type: 'ai-title', aiTitle: 'Review the diff' }),
      50,
    );
    const [old, named, tagged] = await claudeSessions({ dir }).list();
    // Claude Code titled the old one after the briefing; the person's words name it instead.
    expect(old).toMatchObject({ firstPrompt: 'Make the header calm', lastPrompt: 'Make the header calm' });
    expect(old!.title).toBeUndefined();
    expect(named).toMatchObject({ title: 'Title fix', firstPrompt: 'Fix the title' });
    // Claude Code titled the tagged one from the person's words: that title stays.
    expect(tagged).toMatchObject({ title: 'Review the diff', firstPrompt: 'Review the diff' });
    const turns = await claudeSessions({ dir }).read!(old!);
    expect(turns[0]!.prompt).toBe('Make the header calm');
  });

  it('names a Claude Code session nobody typed into by what it was sent', async () => {
    const dir = join(root, 'claude-sent');
    const done = assistant([{ type: 'text', text: 'Done.' }]);
    file(
      join(dir, 'projects', '-work-app', 'task.jsonl'),
      lines(user('<scheduled-task name="nightly">\nRun the nightly check\n</scheduled-task>'), done),
      30,
    );
    file(
      join(dir, 'projects', '-work-app', 'relay.jsonl'),
      lines(
        user('<relay from="phone">Ship it</relay>', { isMeta: true }),
        user('<system-reminder>Be brief</system-reminder>', { isMeta: true }),
        done,
        { type: 'last-prompt', lastPrompt: 'And tag the release' },
      ),
      40,
    );
    const [task, relay] = await claudeSessions({ dir }).list();
    expect(task).toMatchObject({ firstPrompt: 'Run the nightly check', lastPrompt: 'Run the nightly check' });
    expect(relay).toMatchObject({ firstPrompt: 'Ship it', lastPrompt: 'And tag the release', state: 'waiting' });
    // The scheduled one is nobody's conversation; the relayed one is somebody's.
    expect(task!.automated).toBe(true);
    expect(relay!.automated).toBeUndefined();
  });

  it('tells runs a program made from chats through one, and reads the claude.ai project of a relayed session', async () => {
    const dir = join(root, 'claude-origins');
    const done = assistant([{ type: 'text', text: 'Done.' }]);
    const write = (name: string, minutesAgo: number, ...content: unknown[]) =>
      file(join(dir, 'projects', '-work-app', `${name}.jsonl`), lines(...content), minutesAgo);
    const sdk = { turnOrigin: 'sdk', entrypoint: 'sdk-cli' };
    write('scheduled', 10, user('Pin the link', { turnOrigin: 'scheduled', entrypoint: 'claude-desktop' }), done);
    write('headless', 20, user('Review the Git diff in changes.patch', sdk), done);
    write(
      'compacted',
      25,
      user('Run the suite', sdk),
      user('This session is being continued...', { ...sdk, isCompactSummary: true }),
      done,
    );
    // Too long to be read whole: a second prompt may sit in the middle, so it is not called a run.
    write(
      'long-chat',
      27,
      user('Add a tray icon', sdk),
      assistant([{ type: 'text', text: 'x'.repeat(300_000) }]),
      user('Make it monochrome', sdk),
      assistant([{ type: 'text', text: 'y'.repeat(300_000) }]),
    );
    write('older-headless', 30, user('Reply with exactly: ok', { entrypoint: 'sdk-cli' }), done);
    // Somebody chats through a program: more than one prompt.
    write('chat', 40, user('Add a tray icon', sdk), done, user('Make it monochrome', sdk), done);
    write(
      'relayed',
      50,
      {
        type: 'attachment',
        attachment: {
          type: 'prompt_snapshot',
          systemPrompt: [
            'You are...',
            '## Where you are\n\nProject: "Ink & Fury" (id: `chan_01AbC`)\nTopic: "Cut the trailer"\n',
          ],
        },
      },
      { type: 'ai-title', aiTitle: 'Ink & Fury' },
      user('<wake reason="mention"><project id="chan_01AbC" type="project">Cut the trailer</project></wake>', {
        turnOrigin: 'human',
        entrypoint: 'claude-desktop',
      }),
      done,
    );
    write(
      'unnamed',
      60,
      user('<wake><project id="chan_02XyZ" type="project">Go</project></wake>', { turnOrigin: 'human' }),
      done,
    );
    const all = await claudeSessions({ dir }).list();
    expect(all.filter((entry) => entry.automated).map((entry) => entry.id)).toEqual([
      'scheduled',
      'headless',
      'compacted',
      'older-headless',
    ]);
    expect(all.find((entry) => entry.id === 'relayed')).toMatchObject({
      project: { id: 'chan_01AbC', name: 'Ink & Fury' },
      title: 'Cut the trailer',
    });
    expect(all.find((entry) => entry.id === 'unnamed')!.project).toEqual({ id: 'chan_02XyZ' });
    expect(all.find((entry) => entry.id === 'chat')!.project).toBeUndefined();
  });

  it('tells the sessions nobody typed into, and leaves them out of a listing unless asked', async () => {
    const dir = join(root, 'claude-automated');
    const done = assistant([{ type: 'text', text: 'Done.' }]);
    const task = { origin: { kind: 'task-notification' }, promptSource: 'system' };
    const human = { origin: { kind: 'human' } };
    const write = (name: string, minutesAgo: number, ...content: unknown[]) =>
      file(join(dir, 'projects', '-work-app', `${name}.jsonl`), lines(...content), minutesAgo);
    // Every prompt came from a task, whatever its text looks like.
    write('notified', 10, user('Pin the link under the new video', task), done);
    // A scheduled task somebody answered later is a conversation.
    write(
      'answered',
      20,
      user('<scheduled-task name="n">Check</scheduled-task>', task),
      done,
      user('And?', human),
      done,
    );
    // A remote-control turn is a person's, though it arrives wrapped.
    write('remote', 30, user('<wake reason="mention">Fix it</wake>', human), done);
    // `! git status` has no sender noted: not enough to call it automated.
    write('shell', 40, user('<bash-input>git status</bash-input>'), done);
    write('typed', 50, user('Ship it', human), assistant([{ type: 'text', text: 'Shipped. Should I tag it?' }]));
    // No sender noted, a scheduled opening, and a typed follow-up far from the end: a conversation.
    write(
      'long',
      60,
      user('<scheduled-task name="n">Check</scheduled-task>'),
      done,
      user('Why did it fail?'),
      ...Array.from({ length: 40 }, () => assistant([{ type: 'text', text: 'x'.repeat(20_000) }])),
    );
    write('unanswered', 70, user('<scheduled-task name="n">Check</scheduled-task>'), done);
    const source = claudeSessions({ dir });
    const all = await source.list();
    expect(all.filter((entry) => entry.automated).map((entry) => entry.id)).toEqual(['notified', 'unanswered']);
    const shown = await listSessions([source], { limit: 4, live: false, env: { HOME: join(root, 'nobody') } });
    expect(shown.sessions.map((entry) => entry.id)).toEqual(['answered', 'remote', 'shell', 'typed']);
    expect(shown.sessions.map((entry) => entry.ending)).toEqual([undefined, undefined, undefined, 'question']);
    const asked = await listSessions([source], {
      limit: 1,
      automated: true,
      live: false,
      env: { HOME: join(root, 'nobody') },
    });
    expect(asked.sessions.map((entry) => entry.id)).toEqual(['notified']);
    // The automated one took the only place: more are read, so the listing is still full.
    const one = await listSessions([source], { limit: 1, live: false, env: { HOME: join(root, 'nobody') } });
    expect(one.sessions.map((entry) => entry.id)).toEqual(['answered']);
  });

  it('leaves out what ran in a temporary directory or in a worktree genaicode made', async () => {
    const at = (id: string, cwd: string): SessionInfo => ({
      source: 'any',
      agent: 'any',
      id,
      where: 'local',
      cwd,
      updatedAt: 1,
    });
    const source: SessionSource = {
      name: 'any',
      where: 'local',
      list: async () => [
        at('typed', '/Users/me/src/app'),
        at('temp', '/var/folders/ab/T/run-1'),
        at('tmp', '/private/tmp/bench'),
        // Asking somebody right now: still listed.
        { ...at('asking', '/tmp/try'), waitingFor: 'approval' },
        at('windows', 'C:\\Users\\me\\AppData\\Local\\Temp\\run'),
        at('delegated', '/Users/me/src/app/.genaicode/worktrees/t1/app'),
        // A directory that only starts like one of those.
        at('near', '/tmpfiles/app'),
      ],
    };
    const env = { HOME: join(root, 'nobody') };
    const shown = await listSessions([source], { live: false, env });
    expect(shown.sessions.map((entry) => entry.id).sort()).toEqual(['asking', 'near', 'typed']);
    const all = await listSessions([source], { automated: true, live: false, env });
    expect(
      all.sessions
        .filter((entry) => entry.automated)
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(['delegated', 'temp', 'tmp', 'windows']);
    // A hook reports that one of them asks for approval: it is listed while it asks.
    const now = Date.now();
    const fresh: SessionSource = {
      ...source,
      name: 'claude',
      list: async () => [{ ...at('tmp', '/tmp/x'), source: 'claude', updatedAt: now }],
    };
    const hooked = { GENAICODE_HOME: join(root, 'hooked'), HOME: join(root, 'nobody') };
    expect((await listSessions([fresh], { env: hooked })).sessions).toEqual([]);
    await recordHook(
      'claude',
      {
        session_id: 'tmp',
        cwd: '/tmp/x',
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      },
      { env: hooked, now },
    );
    expect((await listSessions([fresh], { env: hooked })).sessions).toMatchObject([
      { id: 'tmp', waitingFor: 'approval' },
    ]);
  });

  it('reads what the end of a message asks of the user', () => {
    const endings = (...texts: string[]) => texts.map((text) => replyEnding(text));
    expect(
      endings('…Mam wysłać to jako preview?', 'Should I delete the frames once you watched it? 🙂', 'Push it?**'),
    ).toEqual(['question', 'question', 'question']);
    expect(endings('…then run: ```bash git merge origin/master ```', 'Wynik: ```json {"ok":true} ```')).toEqual([
      'command',
      undefined,
    ]);
    expect(
      endings(
        '…Rośnie o 2 GB dziennie. Mogę sprawdzić, co tak szybko rośnie.',
        'It is on the branch. If you want me to build this, tell me in the thread.',
      ),
    ).toEqual(['offer', 'offer']);
    expect(
      endings(
        'Gotowe, ale `send_message` zniknęło z tej sesji, więc raport zostaje tutaj.',
        'Done. The tool I report back with is no longer available in this session.',
        'Nie mogę wysłać tego podsumowania do wątku projektu.',
        "I couldn't send this report back to the project thread. Should I retry?",
      ),
    ).toEqual(['unreported', 'unreported', 'unreported', 'unreported']);
    // Requests put as statements, and yes/no gates dressed as offers: seen on real sessions.
    expect(
      endings(
        'To jedyny bloker Gate A. Daj znać, czy teksty pasują i czy mam wypchnąć release.',
        '…i ID filmu do powiązania (pewnie trailer Ink & Fury, ale potwierdź).',
        "Your call whether the current 'host vouches for the table' model is the one you want for the beta.",
        'Filmu nie przerabiałem, to Twoja decyzja.',
        'Musisz jeszcze w Studio: ustawić Related video, okładkę, AI-disclosure.',
        'Usunę je, jeśli potwierdzisz.',
        'Let me know whether to squash it.',
      ),
    ).toEqual(['request', 'request', 'request', 'request', 'request', 'request', 'request']);
    // Not requests: a report that only uses the same roots, and plain offers.
    expect(
      endings(
        'Potwierdzenie wysłałem też w wątku projektu.',
        'Otwarcie nie potwierdza długości rozgrywki.',
        'Then press Escape mid-game to confirm it drops you out.',
        'Mogę ją usunąć, jeśli napiszesz.',
        'If a line sounds wrong, tell me which one and I will regenerate it.',
        'If you need to adjust anything else, I can also help.',
        'Jeśli musisz to zmienić, daj znać.',
        'Nie musisz nic robić, wszystko jest już gotowe.',
        'Nie musisz odpowiadać, mogę też zająć się tym później.',
        "You don't need to do anything, it is all merged.",
      ),
    ).toEqual([undefined, undefined, undefined, 'offer', 'offer', 'offer', 'offer', undefined, 'offer', undefined]);
    expect(
      endings(
        'The token expired, so you need to sign in again before I continue.',
        'You still need to set the cover in Studio.',
        'Czekam na odpowiedź, którą gałąź scalić.',
        "I'm waiting for your go.",
      ),
    ).toEqual(['request', 'request', 'request', 'request']);
    expect(endings('Wszystkie zadania zakończone, raport dotarł do koordynatora.', '')).toEqual([undefined, undefined]);
    expect(replyEnding(undefined)).toBeUndefined();
    expect(endings('Should I proceed? \u26A0\uFE0F', '   \t  🙂  ', 'Let me know. Done.', 'Let me know!')).toEqual([
      'question',
      undefined,
      undefined,
      'offer',
    ]);
    // Linear time on pathological inputs that would backtrack on `+$` / `[^.?!]*$` regexes.
    const started = performance.now();
    expect(replyEnding(`${'\t'.repeat(100_000)}x`)).toBeUndefined();
    expect(replyEnding(`${'mogę '.repeat(50_000)}a?b`)).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('reads Claude Code transcripts', async () => {
    const sessions = await claudeSessions({ dir: claudeDir }).list();
    expect(sessions.map((session) => session.id)).toEqual(['dddd', 'aaaa', 'bbbb']);
    expect(sessions[1]).toMatchObject({
      agent: 'claude',
      where: 'local',
      cwd: '/work/app',
      branch: 'feat/csv',
      title: 'CSV export',
      firstPrompt: 'Add CSV export with tests',
      lastPrompt: 'Now document it',
      lastReply: 'Documented in README.',
      lastReplyAt: Date.parse('2026-11-01T10:03:00Z'),
      model: 'claude-sonnet-5',
      costUsd: 1.25,
      state: 'waiting',
      startedAt: Date.parse('2026-11-01T10:00:00.000Z'),
    });
    expect(sessions[2]).toMatchObject({ state: 'unfinished', lastPrompt: 'Fix the flaky test' });
    expect(sessions[0]).toMatchObject({ state: 'active', cwd: '/work/other' });
  });

  it('reads Codex rollouts', async () => {
    const [session, ...rest] = await codexSessions({ dir: codexDir }).list();
    expect(rest).toEqual([]);
    expect(session).toMatchObject({
      agent: 'codex',
      id: ID,
      cwd: '/work/app',
      branch: 'main',
      firstPrompt: 'Review the CSV export',
      lastReply: 'Two issues found.',
      lastReplyAt: Date.parse('2026-11-02T09:15:00Z'),
      model: 'gpt-5.5-codex',
      usage: { inputTokens: 900, outputTokens: 100, totalTokens: 1000 },
      state: 'waiting',
    });
  });

  it('filters by directory, age and count, and finds nothing in a missing store', async () => {
    const source = claudeSessions({ dir: claudeDir });
    expect((await source.list({ cwd: '/work/app' })).map((session) => session.id)).toEqual(['aaaa', 'bbbb']);
    expect((await source.list({ since: Date.now() - 3_600_000 })).map((session) => session.id)).toEqual([
      'dddd',
      'aaaa',
    ]);
    expect((await source.list({ limit: 1 })).map((session) => session.id)).toEqual(['dddd']);
    expect(await claudeSessions({ dir: join(root, 'missing') }).list()).toEqual([]);
    expect(await codexSessions({ env: { CODEX_HOME: join(root, 'missing') } }).list()).toEqual([]);
  });

  it('merges sources, reports the ones that fail, and groups by project', async () => {
    const broken: SessionSource = { name: 'broken', where: 'cloud', list: () => Promise.reject(new Error('no token')) };
    const { sessions, errors } = await listSessions([
      claudeSessions({ dir: claudeDir }),
      codexSessions({ dir: codexDir }),
      broken,
    ]);
    expect(errors).toEqual([{ source: 'broken', message: 'no token' }]);
    expect(sessions.map((session) => `${session.agent}:${session.id.slice(0, 4)}`)).toEqual([
      'claude:dddd',
      'claude:aaaa',
      'codex:0123',
      'claude:bbbb',
    ]);
    expect(groupSessions(sessions).map((project) => [project.name, project.key, project.agents])).toEqual([
      ['other', '/work/other', { claude: 1 }],
      ['app', '/work/app', { claude: 2, codex: 1 }],
    ]);
  });
});

describe('genaicode sessions', () => {
  const run = async (...argv: string[]) => {
    let out = '';
    let err = '';
    const code = await runCli({
      argv: ['sessions', ...argv],
      env: { HOME: join(root, 'home'), CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexDir },
      cwd: root,
      stdout: { write: (text: string) => void (out += text) },
      stderr: { write: (text: string) => void (err += text) },
      readStdin: async () => undefined,
    });
    return { code, out, err };
  };

  it('lists sessions by project', async () => {
    const { code, out } = await run();
    expect(code).toBe(EXIT_OK);
    expect(out).toContain('app  /work/app  (claude 2, codex 1)');
    expect(out).toMatch(/○ claude\s+30m\s+waiting\s+CSV export\s+aaaa/);
    expect(out).toMatch(/○ codex\s+2h\s+waiting\s+Review the CSV export\s+0123/);
    expect(out).toMatch(/◌ claude\s+10h\s+unfinished\s+Fix the flaky test\s+bbbb/);
  });

  it('takes filters and prints JSON', async () => {
    const { out } = await run('--json', '-a', 'codex', '--since', '1w', '-n', '5');
    const rows = out
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { agent: string });
    expect(rows.map((row) => row.agent)).toEqual(['codex']);
    expect((await run('-a', 'nobody')).err).toContain('No session store');
    expect((await run('-a', 'opencode')).err).toContain('No session store');
    expect((await run('-a', 'gemini')).out).toContain('No sessions found.');
    expect((await run('--since', 'soon')).err).toContain('--since expects');
  });

  it('adds what --cloud finds to the local sessions', async () => {
    let out = '';
    const code = await runCli({
      argv: ['sessions', '--cloud', '--json'],
      env: { HOME: join(root, 'home'), CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexDir },
      cwd: root,
      stdout: { write: (text: string) => void (out += text) },
      stderr: { write: () => undefined },
      readStdin: async () => undefined,
      cloudSources: [
        {
          name: 'github',
          where: 'cloud',
          list: async () => [
            {
              source: 'github',
              agent: 'claude',
              id: 'cmsg_1',
              where: 'cloud',
              updatedAt: Date.now(),
              repository: 'acme/app',
            },
          ],
        },
      ],
    });
    expect(code).toBe(EXIT_OK);
    const lines = out.trim().split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.some((line) => line.includes('"cmsg_1"') && line.includes('"cloud"'))).toBe(true);
  });

  it('groups cloud sessions without a repository under their platform', () => {
    const cloud = { source: 'cursorCloud', agent: 'cursorCloud', where: 'cloud' as const, updatedAt: 2 };
    const projects = groupSessions([
      { ...cloud, id: 'bc-1' },
      { ...cloud, id: 'bc-2', repository: 'https://github.com/org/app.git' },
    ]);
    expect(projects.map((project) => project.name).sort()).toEqual(['app', 'cursorCloud']);
  });
});

describe('times', () => {
  it('reads a zero time as no time', async () => {
    const { timeOf } = await import('./files.js');
    expect(timeOf('0001-01-01T00:00:00Z')).toBeUndefined();
    expect(timeOf('1970-01-01T00:00:00Z')).toBeUndefined();
    expect(timeOf('2026-11-20T00:00:00Z')).toBe(Date.parse('2026-11-20T00:00:00Z'));
  });
});
