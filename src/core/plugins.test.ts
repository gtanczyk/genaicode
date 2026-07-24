import { describe, expect, it } from 'vitest';
import { genaicode } from './client.js';
import { definePlugin, withPlugins } from './plugins.js';
import type { ModelProvider } from './types.js';

describe('provider plugins', () => {
  it('composes request and result middleware in registration order', async () => {
    const events: string[] = [];
    const provider: ModelProvider = {
      name: 'test',
      async generate(request) {
        events.push(`provider:${request.model}`);
        return { parts: [{ type: 'text', text: 'base' }] };
      },
    };
    const outer = definePlugin({
      name: 'outer',
      async generate(request, next) {
        events.push('outer:before');
        const result = await next({ ...request, model: 'rewritten' });
        events.push('outer:after');
        return { ...result, parts: [...result.parts, { type: 'text', text: ':outer' }] };
      },
    });
    const inner = definePlugin({
      name: 'inner',
      async generate(_request, next) {
        events.push('inner:before');
        const result = await next();
        events.push('inner:after');
        return { ...result, parts: [...result.parts, { type: 'text', text: ':inner' }] };
      },
    });

    const ai = genaicode(provider, { plugins: [outer, inner] });

    await expect(ai('hello').text()).resolves.toBe('base:inner:outer');
    expect(events).toEqual(['outer:before', 'inner:before', 'provider:rewritten', 'inner:after', 'outer:after']);
  });

  it('allows intentional short-circuiting', async () => {
    const provider: ModelProvider = {
      name: 'test',
      async generate() {
        throw new Error('provider should not be called');
      },
    };
    const cache = definePlugin({
      name: 'cache',
      async generate() {
        return { parts: [{ type: 'text', text: 'cached' }] };
      },
    });

    await expect(genaicode(withPlugins(provider, [cache]))('hello').text()).resolves.toBe('cached');
  });

  it('rejects a plugin that calls next more than once', async () => {
    const provider: ModelProvider = {
      name: 'test',
      async generate() {
        return { parts: [{ type: 'text', text: 'ok' }] };
      },
    };
    const invalid = definePlugin({
      name: 'invalid',
      async generate(request, next) {
        await next(request);
        return next(request);
      },
    });

    await expect(genaicode(provider, { plugins: [invalid] })('hello').text()).rejects.toThrow(
      'called next() more than once',
    );
  });
});
