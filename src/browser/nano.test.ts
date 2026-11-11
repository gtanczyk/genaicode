import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, ApprovalRequest } from '../agents/types.js';
import { fakeLanguageModel } from './fake-model.js';
import { languageModelAvailability } from './language-model.js';
import { briefing, nano } from './nano.js';
import type { PageTool } from './tools.js';

async function collect(run: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of run) events.push(event);
  return events;
}

const sections: PageTool = {
  name: 'read_section',
  description: 'Read a section of the page.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', enum: ['install', 'agents'] } },
    required: ['id'],
  },
  run: ({ id }) => (id === 'install' ? 'npm install genaicode' : 'claude, codex'),
};

describe('nano', () => {
  it('answers without tools in one streamed prompt', async () => {
    const model = fakeLanguageModel(['Hello there, friend.']);
    const agent = nano({ languageModel: model.factory, instructions: 'You are a wolf.' });
    const events = await collect(agent.run({ prompt: 'hi', cwd: '' }));
    const types = events.map((event) => event.type);
    expect(types).toEqual(['session', 'text-delta', 'text-delta', 'message', 'usage', 'done']);
    const done = events.at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(done.result).toMatchObject({ status: 'completed', ok: true, text: 'Hello there, friend.' });
    expect(done.result.sessionId).toBe('nano-1');
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]).toMatchObject({ input: 'User: hi', streaming: true });
    expect(model.created[0].initialPrompts?.[0]).toMatchObject({ role: 'system' });
    expect(model.created[0].initialPrompts?.[0].content).toContain('You are a wolf.');
    expect(model.created[0].expectedInputs).toEqual([{ type: 'text', languages: ['en'] }]);
  });

  it('picks a tool, fills its arguments against the schema, then replies', async () => {
    const model = fakeLanguageModel([
      '{"action":"read_section"}',
      '{"id":"install"}',
      '{"action":"reply"}',
      'Run npm install genaicode.',
    ]);
    const agent = nano({ languageModel: model.factory, tools: [sections] });
    const events = await collect(agent.run({ prompt: 'how do I install it?', cwd: '' }));

    const start = events.find((event) => event.type === 'tool-start');
    expect(start).toMatchObject({ name: 'read_section', input: { id: 'install' } });
    const end = events.find((event) => event.type === 'tool-end');
    expect(end).toMatchObject({ name: 'read_section', output: 'npm install genaicode' });
    expect((events.at(-1) as Extract<AgentEvent, { type: 'done' }>).result.text).toBe('Run npm install genaicode.');

    const [choice, args, second, answer] = model.calls;
    expect(choice.input).toContain('User: how do I install it?');
    expect(choice.options?.responseConstraint).toMatchObject({
      properties: { action: { enum: ['read_section', 'reply'] } },
    });
    expect(args.options?.responseConstraint).toMatchObject({ properties: { id: { enum: ['install', 'agents'] } } });
    expect(second.input).toContain('Result of read_section:\nnpm install genaicode');
    expect(answer.streaming).toBe(true);
  });

  it('feeds a bad argument back instead of running the tool', async () => {
    const run = vi.fn(() => 'never');
    const model = fakeLanguageModel(['{"action":"read_section"}', '{"id":"pricing"}', '{"action":"reply"}', 'Sorry.']);
    const agent = nano({ languageModel: model.factory, tools: [{ ...sections, run }] });
    const events = await collect(agent.run({ prompt: 'pricing?', cwd: '' }));
    expect(run).not.toHaveBeenCalled();
    expect(events.find((event) => event.type === 'tool-end')).toMatchObject({ isError: true });
    expect(model.calls[2].input).toContain('The call to read_section failed: Bad arguments: "id" must be one of');
  });

  it('does not run the same call twice and answers when the steps run out', async () => {
    const run = vi.fn(() => 'claude, codex');
    // A model stuck on one call.
    const stuck = fakeLanguageModel([
      '{"action":"read_section"}',
      '{"id":"agents"}',
      '{"action":"read_section"}',
      '{"id":"agents"}',
      'It drives claude and codex.',
    ]);
    const agent = nano({ languageModel: stuck.factory, tools: [{ ...sections, run }], maxSteps: 2 });
    const events = await collect(agent.run({ prompt: 'which agents?', cwd: '' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.type === 'tool-end')[1]).toMatchObject({ isError: true });
    expect(stuck.calls.at(-1)?.input).toContain('Now write your reply to the user.');
    expect((events.at(-1) as Extract<AgentEvent, { type: 'done' }>).result.text).toBe('It drives claude and codex.');
  });

  it('asks before a write tool and tells the model when the user declines', async () => {
    const run = vi.fn(() => 'theme is dark');
    const theme: PageTool = {
      name: 'set_theme',
      description: 'Switch the theme.',
      inputSchema: { type: 'object', properties: { theme: { type: 'string', enum: ['dark', 'light'] } } },
      write: true,
      summary: (args) => `Switch to the ${String(args.theme)} theme`,
      run,
    };
    const script = ['{"action":"set_theme"}', '{"theme":"dark"}', '{"action":"reply"}', 'Okay.'];

    const declined = nano({ languageModel: fakeLanguageModel(script).factory, tools: [theme] });
    const onApproval = vi.fn<(request: ApprovalRequest) => 'deny'>(() => 'deny');
    const events = await collect(declined.run({ prompt: 'go dark', cwd: '', onApproval }));
    expect(onApproval.mock.calls[0][0]).toMatchObject({ summary: 'Switch to the dark theme', kind: 'other' });
    expect(run).not.toHaveBeenCalled();
    expect(events.find((event) => event.type === 'approval-resolved')).toMatchObject({ decision: 'deny' });
    expect(events.find((event) => event.type === 'tool-end')).toMatchObject({
      isError: true,
      output: 'The user declined this action.',
    });

    const approved = nano({ languageModel: fakeLanguageModel(script).factory, tools: [theme] });
    await collect(approved.run({ prompt: 'go dark', cwd: '', onApproval: () => 'approve' }));
    expect(run).toHaveBeenCalledWith({ theme: 'dark' }, expect.any(AbortSignal));

    // Nobody to ask: declined.
    run.mockClear();
    const unattended = nano({ languageModel: fakeLanguageModel(script).factory, tools: [theme] });
    await collect(unattended.run({ prompt: 'go dark', cwd: '' }));
    expect(run).not.toHaveBeenCalled();

    const automatic = nano({ languageModel: fakeLanguageModel(script).factory, tools: [theme] });
    const auto = await collect(
      automatic.run({ prompt: 'go dark', cwd: '', permissions: { approval: 'auto-approve' } }),
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(auto.find((event) => event.type === 'approval-resolved')).toMatchObject({ automatic: true });
  });

  it('resumes a conversation in the same model session and forgets it on request', async () => {
    const model = fakeLanguageModel(['One.', 'Two.', 'Three.']);
    const agent = nano({ languageModel: model.factory });
    const first = await agent.run({ prompt: 'a', cwd: '' }).result;
    const second = await agent.run({ prompt: 'b', cwd: '', resume: first.sessionId }).result;
    expect(second.sessionId).toBe(first.sessionId);
    expect(model.created).toHaveLength(1);
    expect(agent.context(first.sessionId!)).toEqual({ used: 20, window: 1000 });
    agent.forget(first.sessionId);
    expect(model.destroyed).toBe(1);
    const third = await agent.run({ prompt: 'c', cwd: '', resume: first.sessionId }).result;
    expect(third.sessionId).not.toBe(first.sessionId);
    expect(model.created).toHaveLength(2);
  });

  it('reports aborts, failures and a missing Prompt API', async () => {
    const slow = fakeLanguageModel([() => new Promise<string>(() => {})]);
    const agent = nano({ languageModel: slow.factory });
    const run = agent.run({ prompt: 'wait', cwd: '' });
    setTimeout(() => run.abort(), 5);
    expect(await run.result).toMatchObject({ status: 'aborted', ok: false });

    const broken = fakeLanguageModel([
      () => {
        throw Object.assign(new Error('too big'), { name: 'QuotaExceededError' });
      },
    ]);
    const failed = await nano({ languageModel: broken.factory }).run({ prompt: 'x', cwd: '' }).result;
    expect(failed).toMatchObject({ status: 'failed', error: expect.stringContaining('context window') });

    const missing = await nano().run({ prompt: 'x', cwd: '' }).result;
    expect(missing).toMatchObject({ status: 'failed', error: expect.stringContaining('no built-in language model') });
    expect(await nano().availability()).toBe('unavailable');
  });

  it('reports download progress and availability', async () => {
    const onDownload = vi.fn();
    const model = fakeLanguageModel(['ok'], { availability: 'downloadable', download: [0, 0.5, 1] });
    const agent = nano({ languageModel: model.factory, onDownload });
    expect(await agent.availability()).toBe('downloadable');
    await agent.prepare();
    expect(onDownload.mock.calls.map(([progress]) => progress)).toEqual([0, 0.5, 1]);
    expect(model.destroyed).toBe(1);
    expect(await languageModelAvailability('en', fakeLanguageModel([], { availability: 'readily' }).factory)).toBe(
      'available',
    );
  });

  it('briefs the model with tool signatures', () => {
    const text = briefing('Be brief.', [sections, { name: 'ping', description: 'Ping.', run: () => 'pong' }]);
    expect(text).toContain('- read_section(id: "install"|"agents"): Read a section of the page.');
    expect(text).toContain('- ping(): Ping.');
    expect(briefing(undefined, [])).not.toContain('tools');
  });
});
