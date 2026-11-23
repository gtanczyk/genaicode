import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EventQueue } from './event-queue.js';
import { delegationBrief, pack } from './pack.js';
import type { AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent, McpServer } from './types.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'genaicode-delegate-test-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fake(name: string, body: (task: AgentTask) => Promise<Partial<AgentResult> | void>, mcp = false): CodingAgent {
  return {
    name,
    command: process.execPath,
    capabilities: { mcp },
    runText: () => {
      throw new Error(`${name} runText`);
    },
    run(task): AgentRun {
      const events = new EventQueue<AgentEvent>();
      const result = body(task).then((extra): AgentResult => {
        const final = { status: 'completed' as const, ok: true, exitCode: 0, signal: null, ...extra };
        events.push({ type: 'done', result: final });
        events.close();
        return final;
      });
      return { result, abort() {}, [Symbol.asyncIterator]: () => events.iterate() };
    },
  };
}

async function tool(task: AgentTask, name: string, args: Record<string, unknown>): Promise<string> {
  const server = task.mcpServers?.find((candidate) => candidate.name === 'pack') as Extract<McpServer, { url: string }>;
  const response = await fetch(server.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...server.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const answer = (await response.json()) as { result: { content: [{ text: string }]; isError?: boolean } };
  if (answer.result.isError) throw new Error(answer.result.content[0].text);
  return answer.result.content[0].text;
}

describe('pack delegation for a chat agent', () => {
  it('runs a task in another directory, passes read-only commands and asks for the rest', async () => {
    const home = mkdtempSync(join(root, 'home-'));
    const game = join(root, 'game');
    execFileSync('git', ['init', '-q', game]);
    const asked: string[] = [];
    const member = fake('agy', async (task) => {
      expect(task.cwd).toBe(game);
      const read = await task.onApproval!({
        id: 'r',
        kind: 'command',
        detail: { toolCall: { rawInput: { CommandLine: 'ls -la && git log -5' } } },
      });
      const outside = await task.onApproval!({ id: 'o', kind: 'command', detail: { command: 'cat ~/.ssh/id_rsa' } });
      const write = await task.onApproval!({ id: 'w', kind: 'command', detail: { command: 'rm -rf build' } });
      return { text: `${read} ${outside} ${write}` };
    });
    let prompt = '';
    const lead = fake(
      'claude',
      async (task) => {
        prompt = task.prompt;
        await expect(tool(task, 'delegate', { agent: 'agy', prompt: 'x', cwd: join(root, 'nope') })).rejects.toThrow(
          'not a directory',
        );
        await tool(task, 'delegate', { agent: 'agy', prompt: 'review', mode: 'shared', cwd: game });
        const [report] = JSON.parse(await tool(task, 'wait', { ids: ['t1'] })) as [{ text: string; cwd: string }];
        expect(report).toMatchObject({ text: 'approve deny approve', cwd: game });
      },
      true,
    );
    const team = pack({ name: 'claude', lead, members: [member], brief: delegationBrief, operatorMerge: true });
    expect(team.name).toBe('claude');
    expect(() => team.runText!({ prompt: 'p', cwd: home })).toThrow('claude runText');
    const result = await team.run({
      prompt: 'go',
      cwd: home,
      permissions: { approval: 'ask' },
      onApproval: (request) => {
        asked.push(request.id);
        return request.id.endsWith(':o') ? 'deny' : 'approve';
      },
    }).result;
    expect(result.ok).toBe(true);
    expect(asked).toEqual(['t1:o', 't1:w']);
    expect(prompt).toContain('never its CLI from a shell');
    expect(prompt).toContain('agy');
  });

  it('asks for read-only commands with readOnlyCommands: ask, and outside a repository', async () => {
    const cwd = mkdtempSync(join(root, 'ask-'));
    execFileSync('git', ['init', '-q', cwd]);
    const asked: string[] = [];
    const member = fake('agy', async (task) => {
      await task.onApproval!({ id: 'r', kind: 'command', detail: { command: 'ls' } });
    });
    const lead = fake(
      'claude',
      async (task) => {
        await tool(task, 'delegate', { agent: 'agy', prompt: 'x', mode: 'shared' });
        await tool(task, 'wait', { ids: ['t1'] });
      },
      true,
    );
    await pack({ lead, members: [member], readOnlyCommands: 'ask' }).run({
      prompt: 'go',
      cwd,
      onApproval: (request) => {
        asked.push(request.id);
        return 'approve';
      },
    }).result;
    expect(asked).toEqual(['t1:r']);
    asked.length = 0;
    const plain = mkdtempSync(join(root, 'plain-'));
    await pack({ lead, members: [member] }).run({
      prompt: 'go',
      cwd: plain,
      onApproval: (request) => {
        asked.push(request.id);
        return 'approve';
      },
    }).result;
    expect(asked).toEqual(['t1:r']);
  });

  it('passes a model, effort and the lead MCP servers by name, and asks the lead not to confirm first', async () => {
    const cwd = mkdtempSync(join(root, 'options-'));
    const seen: AgentTask[] = [];
    const member: CodingAgent = {
      ...fake('agy', async (task) => {
        seen.push(task);
      }),
      capabilities: { mcp: true, effort: ['low', 'high'] },
    };
    const gamedev: McpServer = { name: 'gamedevpl', url: 'https://example.test/mcp', headers: { authorization: 'k' } };
    let prompt = '';
    const lead = fake(
      'claude',
      async (task) => {
        prompt = task.prompt;
        const roster = JSON.parse(await tool(task, 'agents', {})) as [{ effort?: string[] }];
        expect(roster[0].effort).toEqual(['low', 'high']);
        await expect(
          tool(task, 'delegate', { agent: 'agy', prompt: 'x', mode: 'shared', mcpServers: ['nope'] }),
        ).rejects.toThrow('Available: gamedevpl, given');
        await expect(
          tool(task, 'delegate', { agent: 'agy', prompt: 'x', mode: 'shared', effort: 'max' }),
        ).rejects.toThrow('agy takes effort low, high');
        await tool(task, 'delegate', {
          agent: 'agy',
          title: '  Visual   uplift ',
          prompt: 'make it pretty',
          mode: 'shared',
          model: 'gemini-4-neon',
          effort: 'high',
          mcpServers: ['gamedevpl'],
        });
        const [report] = JSON.parse(await tool(task, 'wait', { ids: ['t1'] })) as [Record<string, unknown>];
        expect(report).toMatchObject({
          title: 'Visual uplift',
          model: 'gemini-4-neon',
          effort: 'high',
          mcpServers: ['gamedevpl'],
        });
      },
      true,
    );
    const team = pack({
      lead,
      members: [member],
      brief: delegationBrief,
      shareableMcpServers: async () => [gamedev],
    });
    const result = await team.run({
      prompt: 'go',
      cwd,
      mcpServers: [{ name: 'given', command: 'node' }],
    }).result;
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ model: 'gemini-4-neon', effort: 'high', mcpServers: [gamedev] });
    expect(prompt).toContain('Yours: gamedevpl, given.');
    expect(prompt).toContain('delegate right away');
    expect(team.tasks()[0]).toMatchObject({ title: 'Visual uplift', mcpServers: ['gamedevpl'] });
  });
});
