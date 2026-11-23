import { describe, expect, it } from 'vitest';
import { askUserTool, startQuestionChannel } from './ask-user.js';
import { createAgentSession } from './session.js';
import type { AgentCapabilities, AgentResult, AgentRun, AgentTask, ApprovalRequest, CodingAgent } from './types.js';

const questions = [
  {
    question: 'Which database?',
    header: 'Database',
    options: [{ label: 'Postgres', description: 'Relational' }, { label: 'SQLite' }],
  },
  { question: 'Which features?', options: ['Search', { label: 'Export' }], multiple: true },
];

describe('askUserTool', () => {
  it('turns the call into a question and returns the answers as text', async () => {
    const asked: ApprovalRequest[] = [];
    const tool = askUserTool(() => (request) => {
      asked.push(request);
      return { q1: ['SQLite'], q2: ['Search', 'Audit log'] };
    });
    expect(await tool.call({ questions })).toBe(
      'The user answered:\nWhich database? SQLite\nWhich features? Search, Audit log',
    );
    expect(asked[0]).toMatchObject({
      kind: 'question',
      summary: 'Which database?',
      questions: [
        {
          id: 'q1',
          question: 'Which database?',
          header: 'Database',
          options: [{ label: 'Postgres', description: 'Relational' }, { label: 'SQLite' }],
          freeText: true,
        },
        {
          id: 'q2',
          question: 'Which features?',
          options: [{ label: 'Search' }, { label: 'Export' }],
          multiple: true,
          freeText: true,
        },
      ],
    });
    expect(asked[0]!.id).toMatch(/^ask-/);
  });

  it('says when nobody answered, part was skipped, or nobody can be asked', async () => {
    expect(await askUserTool(() => () => undefined).call({ questions })).toContain('did not answer');
    expect(await askUserTool(() => () => ({ q2: ['Export'] })).call({ questions })).toBe(
      'The user answered:\nWhich features? Export\n(1 left unanswered.)',
    );
    expect(
      await askUserTool(() => () => {
        throw new Error('gone');
      }).call({ questions }),
    ).toContain('did not answer');
    expect(await askUserTool(() => undefined).call({ questions })).toContain('Nobody can answer');
  });

  it('refuses malformed questions without asking', async () => {
    let asked = 0;
    const tool = askUserTool(() => () => (asked++, {}));
    for (const bad of [
      undefined,
      [],
      'x',
      [{ options: [] }],
      [{ question: 'Q?', options: [{}] }],
      Array(5).fill(questions[0]),
    ])
      expect(await tool.call({ questions: bad })).toMatch(/^Invalid questions/);
    expect(asked).toBe(0);
  });
});

describe('question channel in a session', () => {
  /** An agent that calls `ask_user` over MCP in its turn, the way an agent CLI would. */
  function askingAgent(capabilities: AgentCapabilities) {
    const tasks: AgentTask[] = [];
    const replies: string[] = [];
    const agent: CodingAgent = {
      name: 'asker',
      command: 'asker',
      capabilities,
      run(task): AgentRun {
        tasks.push(task);
        const result: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null };
        const done = (async () => {
          const server = task.mcpServers?.find((candidate) => candidate.name === 'genaicode_ask') as
            | { url: string; headers: Record<string, string> }
            | undefined;
          if (server) {
            const response = await fetch(server.url, {
              method: 'POST',
              headers: { 'content-type': 'application/json', ...server.headers },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: { name: 'ask_user', arguments: { questions } },
              }),
            });
            const body = (await response.json()) as { result: { content: Array<{ text: string }> } };
            replies.push(body.result.content[0]!.text);
          }
          return result;
        })();
        return {
          result: done,
          abort() {},
          async *[Symbol.asyncIterator]() {
            await done;
            yield { type: 'done', result };
          },
        };
      },
    };
    return { agent, tasks, replies };
  }

  it('gives ask_user to agents that cannot ask, and answers it from the session', async () => {
    const channel = await startQuestionChannel();
    try {
      const { agent, tasks, replies } = askingAgent({ mcp: true });
      const session = createAgentSession({ agent, cwd: '.', questions: channel, autoApprove: () => 'approve' });
      session.send('plan it');
      await expect.poll(() => session.get().approvals.length).toBe(1);
      const request = session.get().approvals[0]!;
      expect(request.kind).toBe('question');
      expect(session.answer(request.id, { q1: ['Postgres'] })).toBe(true);
      await session.idle();
      expect(replies).toEqual(['The user answered:\nWhich database? Postgres\n(1 left unanswered.)']);
      expect(tasks[0]!.mcpServers?.map((server) => server.name)).toEqual(['genaicode_ask']);
      // A person may take minutes: Codex is told to wait (its own default is 60 s).
      expect(tasks[0]!.mcpServers?.[0]).toMatchObject({ toolTimeoutSec: 86_400, trusted: true });
      expect(session.get().turns[0]!.entries).toContainEqual({
        kind: 'approval',
        request,
        decision: 'approve',
        answers: { q1: ['Postgres'] },
      });
      session.close();
    } finally {
      await channel.close();
    }
  });

  it('leaves it out for agents that ask on their own, run remotely or take no MCP servers', async () => {
    const channel = await startQuestionChannel();
    try {
      for (const capabilities of [{ mcp: true, questions: true }, { mcp: true, remote: true }, {}]) {
        const { agent, tasks } = askingAgent(capabilities);
        const session = createAgentSession({ agent, cwd: '.', questions: channel });
        session.send('go');
        await session.idle();
        expect(tasks[0]!.mcpServers ?? []).toEqual([]);
        session.close();
      }
    } finally {
      await channel.close();
    }
  });
});
