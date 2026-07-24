import { describe, expect, it } from 'vitest';
import { genaicode } from './client.js';
import type { GenerationRequest, GenerationResult, ModelProvider } from './types.js';

function sequenceProvider(results: GenerationResult[]) {
  const requests: GenerationRequest[] = [];
  const provider: ModelProvider = {
    name: 'test',
    async generate(request) {
      requests.push(request);
      const result = results.shift();
      if (!result) throw new Error('No test result configured.');
      return result;
    },
  };
  return { provider, requests };
}

describe('genaicode client', () => {
  it('builds immutable requests and extracts text', async () => {
    const { provider, requests } = sequenceProvider([{ parts: [{ type: 'text', text: 'hello' }] }]);
    const ai = genaicode(provider, { model: 'test-model' });
    const base = ai('question');
    const configured = base.system('rules').temperature(0.2);

    await expect(configured.text()).resolves.toBe('hello');
    expect(base.inspect().prompt).toEqual([{ type: 'user', text: 'question' }]);
    expect(requests[0]).toMatchObject({
      model: 'test-model',
      temperature: 0.2,
      prompt: [
        { type: 'systemPrompt', systemPrompt: 'rules' },
        { type: 'user', text: 'question' },
      ],
    });
  });

  it('carries generated turns through a conversation chain', async () => {
    const { provider, requests } = sequenceProvider([
      { parts: [{ type: 'text', text: 'answer one' }] },
      { parts: [{ type: 'text', text: 'answer two' }] },
    ]);
    const ai = genaicode(provider);
    const chain = ai.chain({ type: 'systemPrompt', systemPrompt: 'rules' });

    await expect(chain.text('prompt one')).resolves.toBe('answer one');
    await expect(chain.text('prompt two')).resolves.toBe('answer two');
    expect(requests).toHaveLength(2);
    expect(requests[1].prompt).toEqual([
      { type: 'systemPrompt', systemPrompt: 'rules' },
      { type: 'user', text: 'prompt one' },
      {
        type: 'assistant',
        text: 'answer one',
        images: [],
        toolCalls: [],
      },
      { type: 'user', text: 'prompt two' },
    ]);
  });

  it('supports an ordinary loop and serializes concurrent turns', async () => {
    const { provider, requests } = sequenceProvider([
      { parts: [{ type: 'text', text: 'one' }] },
      { parts: [{ type: 'text', text: 'two' }] },
      { parts: [{ type: 'text', text: 'three' }] },
    ]);
    const chain = genaicode(provider).chain();

    const answers: string[] = [];
    for (const input of ['first', 'second', 'third']) {
      answers.push(await chain.text(input));
    }

    expect(answers).toEqual(['one', 'two', 'three']);
    expect(requests.map((request) => request.prompt.length)).toEqual([1, 3, 5]);
  });

  it('does not add failed turns to chain history', async () => {
    const provider: ModelProvider = {
      name: 'failing',
      async generate() {
        throw new Error('network failed');
      },
    };
    const chain = genaicode(provider).chain({ type: 'systemPrompt', systemPrompt: 'rules' });

    await expect(chain.text('question')).rejects.toThrow('network failed');
    expect(chain.history()).toEqual([{ type: 'systemPrompt', systemPrompt: 'rules' }]);
  });

  it('resets safely while turns are in flight or queued', async () => {
    let finishGeneration: ((result: GenerationResult) => void) | undefined;
    const requests: GenerationRequest[] = [];
    const provider: ModelProvider = {
      name: 'delayed',
      generate: (request) => {
        requests.push(request);
        if (requests.length === 1) {
          return new Promise<GenerationResult>((resolve) => {
            finishGeneration = resolve;
          });
        }
        return Promise.resolve({ parts: [{ type: 'text', text: 'fresh answer' }] });
      },
    };
    const chain = genaicode(provider).chain('old context');
    const inFlight = chain.text('old question');
    const queued = chain.text('new question');

    await Promise.resolve();
    chain.reset('new context');
    finishGeneration?.({ parts: [{ type: 'text', text: 'stale answer' }] });

    await expect(inFlight).resolves.toBe('stale answer');
    await expect(queued).resolves.toBe('fresh answer');
    expect(requests[1].prompt).toEqual([
      { type: 'user', text: 'new context' },
      { type: 'user', text: 'new question' },
    ]);
    expect(chain.history()).toEqual([
      { type: 'user', text: 'new context' },
      { type: 'user', text: 'new question' },
      { type: 'assistant', text: 'fresh answer', images: [], toolCalls: [] },
    ]);
  });
});
