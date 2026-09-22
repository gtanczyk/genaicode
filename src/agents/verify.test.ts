import { describe, expect, it } from 'vitest';
import type { AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent } from './types.js';
import { runWithVerify } from './verify.js';

function scriptedAgent(results: Partial<AgentResult>[]) {
  const prompts: string[] = [];
  const agent: CodingAgent = {
    name: 'scripted',
    command: 'scripted',
    capabilities: {},
    run(task: AgentTask): AgentRun {
      prompts.push(task.prompt);
      const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null, ...results.shift() };
      const events: AgentEvent[] = [
        { type: 'message', text: 'working' },
        { type: 'done', result },
      ];
      return {
        result: Promise.resolve(result),
        abort() {},
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
      };
    },
  };
  return { agent, prompts };
}

describe('runWithVerify', () => {
  it('feeds failed checks back until they pass', async () => {
    const { agent, prompts } = scriptedAgent([{}, {}]);
    const reports = [{ ok: false, detail: 'test a failed' }, { ok: true }];
    const seen: number[] = [];
    const outcome = await runWithVerify(
      agent,
      { prompt: 'do it', cwd: '.' },
      {
        verify: () => reports.shift()!,
        onEvent: (_event, attempt) => seen.push(attempt),
      },
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.attempts).toHaveLength(2);
    expect(prompts[1]).toContain('do it');
    expect(prompts[1]).toContain('<verification-report>\ntest a failed\n</verification-report>');
    expect(seen).toEqual([0, 0, 1, 1]);
  });

  it('stops after the repair budget', async () => {
    const { agent } = scriptedAgent([{}, {}]);
    const outcome = await runWithVerify(
      agent,
      { prompt: 'p', cwd: '.' },
      {
        verify: () => ({ ok: false, detail: 'still red' }),
        maxRepairs: 1,
        repairPrompt: ({ report, attempt }) => `repair ${attempt}: ${report.detail}`,
      },
    );
    expect(outcome).toMatchObject({ ok: false, error: 'Verification still fails after 1 repair attempt(s).' });
    expect(outcome.attempts.map((attempt) => attempt.prompt)).toEqual(['p', 'repair 1: still red']);
  });

  it('does not verify a run that failed', async () => {
    const { agent } = scriptedAgent([{ status: 'failed', ok: false, error: 'crashed' }]);
    let verified = false;
    const outcome = await runWithVerify(
      agent,
      { prompt: 'p', cwd: '.' },
      {
        verify: () => {
          verified = true;
          return { ok: true };
        },
      },
    );
    expect(outcome).toMatchObject({ ok: false, error: 'crashed' });
    expect(verified).toBe(false);
  });
});
