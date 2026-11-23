import { describe, expect, it } from 'vitest';
import type { SessionState, SessionTurn } from '../agents/session.js';
import type { SessionInfo } from '../agents/sessions/types.js';
import type { ChatView } from './controller.js';
import {
  chatTranscriptJson,
  formatChatTranscriptMarkdown,
  formatStoredSessionMarkdown,
  storedSessionTranscriptJson,
  transcriptFilename,
} from './transcript.js';

function baseView(overrides: Partial<SessionState> = {}, notices: ChatView['notices'] = []): ChatView {
  return {
    session: {
      agent: 'claude',
      cwd: '/work/app',
      model: 'claude-sonnet-4-6',
      effort: 'high',
      sessionId: 'ses_0195abcdef123456',
      status: 'idle',
      turns: [],
      queued: [],
      approvals: [],
      usage: { inputTokens: 1200, outputTokens: 300 },
      costUsd: 0.042,
      canSteer: false,
      ...overrides,
    },
    notices,
    agents: [],
    bark: true,
    autoApprove: false,
    shells: 0,
  };
}

describe('transcript export', () => {
  it('formats an active chat as Markdown with metadata, notices, entries, approvals, questions and pack tasks', () => {
    const turn: SessionTurn = {
      id: 1,
      agent: 'claude',
      prompt: 'Check tests and fix the flaky one.',
      startedAt: Date.parse('2026-11-23T21:00:00.000Z'),
      endedAt: Date.parse('2026-11-23T21:00:14.000Z'),
      attachments: [{ name: 'log.txt', mediaType: 'text/plain', size: 2048 }],
      entries: [
        { kind: 'text', text: 'Running the test suite first.', streaming: false },
        {
          kind: 'tool',
          id: 't1',
          name: 'Bash',
          input: { command: 'npm test', timeout: 5000 },
          output: '1 failed\n```code```',
          isError: true,
          done: true,
        },
        { kind: 'input', text: 'Focus on transcript.test.ts only.' },
        {
          kind: 'approval',
          request: { id: 'ap1', kind: 'command', summary: 'npm test' },
          decision: 'approve',
          automatic: true,
        },
        {
          kind: 'approval',
          request: {
            id: 'q1',
            kind: 'question',
            questions: [
              {
                id: 'fmt',
                header: 'Format',
                question: 'Which format?',
                options: [{ label: 'Markdown' }, { label: 'JSON' }],
              },
            ],
          },
          decision: 'approve',
          answers: { fmt: ['Markdown'] },
        },
        { kind: 'files', paths: ['src/foo.ts'], diff: '@@ -1 +1 @@\n-old\n+new' },
        {
          kind: 'artifact',
          artifact: {
            id: 'art1',
            name: 'report',
            title: 'Test Report',
            kind: 'text',
            mimeType: 'text/plain',
            bytes: 12,
            version: 1,
          },
        },
        { kind: 'error', message: 'Minor warning' },
        {
          kind: 'failover',
          from: 'claude',
          to: 'codex',
          failure: { kind: 'quota' },
        },
      ],
      pack: {
        lead: 'claude',
        maxParallel: 2,
        interactive: true,
        tasks: [
          {
            id: 'p1',
            agent: 'codex',
            title: 'Check edge cases',
            prompt: 'Inspect edge cases in transcript formatting.',
            model: 'gpt-5',
            effort: 'medium',
            mcpServers: ['sessions'],
            mode: 'worktree',
            status: 'completed',
            state: 'unmerged',
            cwd: '/work/app/.genaicode/worktrees/p1',
            changes: ['M\tsrc/foo.ts'],
            text: 'All edge cases covered.',
            checks: {
              revision: 'abc',
              verify: { revision: 'abc', status: 'completed', detail: '42 passed' },
            },
          },
        ],
      },
      result: { status: 'completed', ok: true, exitCode: 0, signal: null, text: 'Fixed the flaky test.' },
      usage: { inputTokens: 1200, outputTokens: 300 },
      costUsd: 0.042,
    };

    const view = baseView({ turns: [turn], queued: ['Now update docs'] }, [
      { id: 1, afterTurn: 0, text: 'Session restored.', tone: 'info' },
      { id: 2, afterTurn: 1, text: 'Rate limit warning', tone: 'error' },
    ]);

    const md = formatChatTranscriptMarkdown({
      view,
      version: '2.54.0',
      sessionPath: '/Users/me/.claude/projects/app/ses_0195abcdef123456.jsonl',
      exportedAt: '2026-11-23T21:05:00.000Z',
      readArtifact: (id) =>
        id === 'art1'
          ? {
              artifact: turn.entries.find((e) => e.kind === 'artifact')!.artifact,
              body: Buffer.from('All green!\n'),
            }
          : undefined,
    });

    expect(md).toContain('# Genaicode transcript');
    expect(md).toContain('- **Version:** 2.54.0');
    expect(md).toContain('- **Session ID:** ses_0195abcdef123456');
    expect(md).toContain('- **Session file:** /Users/me/.claude/projects/app/ses_0195abcdef123456.jsonl');
    expect(md).toContain('> **Notice:** Session restored.');
    expect(md).toContain('## Turn 1 · claude · 2026-11-23T21:00:00.000Z (14s)');
    expect(md).toContain('- `log.txt` (text/plain, 2.0 KB)');
    expect(md).toContain('- **Tool** `Bash` `npm test` (failed)');
    expect(md).toContain('````\n1 failed\n```code```\n````');
    expect(md).toContain('### User (during turn)\n\nFocus on transcript.test.ts only.');
    expect(md).toContain('- **Approval** (`command`): npm test → approve (automatic)');
    expect(md).toContain('- **Question** (answered):\n  - Format: Which format? → Markdown');
    expect(md).toContain('- **Changed files:** `src/foo.ts`');
    expect(md).toContain('```diff\n@@ -1 +1 @@\n-old\n+new\n```');
    expect(md).toContain('- **Artifact:** "Test Report"');
    expect(md).toContain('All green!');
    expect(md).toContain('- **Error:** Minor warning');
    expect(md).toContain('- **Failover:**');
    expect(md).toContain('#### Task p1: Check edge cases (codex, worktree, completed, unmerged)');
    expect(md).toContain('- **MCP servers:** sessions');
    expect(md).toContain('**Verify check:** completed');
    expect(md).toContain('42 passed');
    expect(md).toContain('Fixed the flaky test.');
    expect(md).toContain('> **Error notice:** Rate limit warning');
    expect(md).toContain('## Queued prompts\n\n- Now update docs');
  });

  it('builds structured JSON for the active chat', () => {
    const view = baseView({}, [{ id: 1, afterTurn: 0, text: 'Ready', tone: 'info' }]);
    const json = chatTranscriptJson({
      view,
      version: '2.54.0',
      sessionPath: '/tmp/session.jsonl',
      exportedAt: '2026-11-23T21:05:00.000Z',
    });
    expect(json).toMatchObject({
      format: 'genaicode-transcript',
      formatVersion: 1,
      version: '2.54.0',
      exportedAt: '2026-11-23T21:05:00.000Z',
      sessionId: 'ses_0195abcdef123456',
      sessionPath: '/tmp/session.jsonl',
      autoApprove: false,
      notices: [{ id: 1, text: 'Ready' }],
    });
    expect(json.session).toBe(view.session);
  });

  it('formats stored sessions both when readable and when metadata-only', () => {
    const session: SessionInfo = {
      source: 'claude',
      agent: 'claude',
      id: 'abc-12345678',
      where: 'local',
      cwd: '/work/project',
      branch: 'main',
      title: 'Investigate bug',
      firstPrompt: 'Why did it crash?',
      lastReply: 'Missing null check.',
      path: '/Users/me/.claude/projects/work/abc-12345678.jsonl',
      state: 'waiting',
      updatedAt: Date.parse('2026-11-23T20:00:00.000Z'),
    };
    const readableMd = formatStoredSessionMarkdown({
      session,
      readable: true,
      turns: [
        {
          id: 1,
          agent: 'claude',
          prompt: 'Why did it crash?',
          entries: [{ kind: 'text', text: 'Missing null check.', streaming: false }],
          startedAt: Date.parse('2026-11-23T19:59:00.000Z'),
          endedAt: Date.parse('2026-11-23T19:59:10.000Z'),
        },
      ],
      exportedAt: '2026-11-23T21:00:00.000Z',
    });
    expect(readableMd).toContain('# Session transcript');
    expect(readableMd).toContain('- **Session ID:** abc-12345678');
    expect(readableMd).toContain('- **Session file:** /Users/me/.claude/projects/work/abc-12345678.jsonl');
    expect(readableMd).toContain('Why did it crash?');
    expect(readableMd).toContain('Missing null check.');

    const unreadableMd = formatStoredSessionMarkdown({
      session,
      readable: false,
      turns: [],
      exportedAt: '2026-11-23T21:00:00.000Z',
    });
    expect(unreadableMd).toContain('cannot be read yet; metadata only');
    expect(unreadableMd).toContain('### First prompt\n\nWhy did it crash?');
    expect(unreadableMd).toContain('### Last reply\n\nMissing null check.');

    const json = storedSessionTranscriptJson({
      session,
      readable: true,
      turns: [],
      version: '2.54.0',
      exportedAt: '2026-11-23T21:00:00.000Z',
    });
    expect(json).toMatchObject({
      format: 'genaicode-session-transcript',
      formatVersion: 1,
      readable: true,
      session,
      turns: [],
    });
  });

  it('builds safe transcript filenames', () => {
    expect(
      transcriptFilename({
        agent: 'claude',
        sessionId: '01950123-4567-89ab-cdef-0123456789ab',
        format: 'md',
      }),
    ).toBe('genaicode-claude-456789ab.md');
    expect(
      transcriptFilename({
        agent: '../weird agent',
        sessionId: '../../etc/passwd',
        format: 'json',
      }),
    ).toBe('genaicode-weird-agent-etc-passwd.json');
    expect(
      transcriptFilename({
        agent: 'codex',
        format: 'md',
        exportedAt: new Date('2026-11-23T21:05:09.000Z'),
      }),
    ).toBe('genaicode-codex-2026-11-23T21-05-09.md');
  });

  it('preserves multiline and long string tool inputs when omitted inline', () => {
    const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch';
    const longInput = 'x'.repeat(200);
    const view = baseView({
      turns: [
        {
          id: 1,
          agent: 'codex',
          prompt: 'Patch the file',
          startedAt: Date.parse('2026-11-23T21:00:00.000Z'),
          endedAt: Date.parse('2026-11-23T21:00:02.000Z'),
          entries: [
            { kind: 'tool', name: 'apply_patch', input: patch, output: 'Patched', done: true },
            { kind: 'tool', name: 'custom', input: longInput, done: true },
            { kind: 'tool', name: 'shell', input: 'git status', done: true },
          ],
        },
      ],
    });
    const md = formatChatTranscriptMarkdown({ view, exportedAt: '2026-11-23T21:05:00.000Z' });
    expect(md).toContain(`- **Tool** \`apply_patch\` (ok)\n\n\`\`\`\n${patch}\n\`\`\``);
    expect(md).toContain(`- **Tool** \`custom\` (ok)\n\n\`\`\`\n${longInput}\n\`\`\``);
    // Short single-line string input stays inline without a duplicate fenced block.
    expect(md).toContain('- **Tool** `shell` `git status` (ok)');
    expect(md).not.toContain('```\ngit status\n```');
  });

  it('discloses when active or stored transcripts omit earlier turns', () => {
    const view = baseView({
      turns: [
        {
          id: 5,
          agent: 'claude',
          prompt: 'Latest prompt',
          entries: [{ kind: 'text', text: 'Latest answer', streaming: false }],
          startedAt: Date.parse('2026-11-23T21:00:00.000Z'),
        },
      ],
    });
    const activeMd = formatChatTranscriptMarkdown({ view, exportedAt: '2026-11-23T21:05:00.000Z' });
    expect(activeMd).toContain('- **Incomplete:** Only turns starting from turn 5 are kept in memory');
    expect(activeMd).toContain('> **Note:** Only turns starting from turn 5 are kept in memory');
    expect(chatTranscriptJson({ view, exportedAt: '2026-11-23T21:05:00.000Z' })).toMatchObject({
      truncated: true,
      truncatedReason: expect.stringContaining('turn 5'),
    });

    const session: SessionInfo = {
      source: 'codex',
      agent: 'codex',
      id: 'long-session',
      where: 'local',
      updatedAt: Date.parse('2026-11-23T20:00:00.000Z'),
    };
    const reason = 'Only the latest 200 turns were exported; earlier turns were omitted.';
    const storedMd = formatStoredSessionMarkdown({
      session,
      readable: true,
      truncated: true,
      truncatedReason: reason,
      turns: [{ id: 1, agent: 'codex', prompt: 'Turn 201', entries: [], startedAt: 1 }],
      exportedAt: '2026-11-23T21:00:00.000Z',
    });
    expect(storedMd).toContain(`- **Incomplete:** ${reason}`);
    expect(storedMd).toContain(`> **Note:** ${reason} Turn numbers below start from the first exported turn.`);
    expect(
      storedSessionTranscriptJson({
        session,
        readable: true,
        truncated: true,
        truncatedReason: reason,
        turns: [],
        exportedAt: '2026-11-23T21:00:00.000Z',
      }),
    ).toMatchObject({
      truncated: true,
      truncatedReason: reason,
    });
  });
});
