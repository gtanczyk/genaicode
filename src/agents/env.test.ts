import { describe, expect, it } from 'vitest';
import { scrubEnv, withoutProviderCredentials } from './env.js';

describe('env scrubbing', () => {
  it('drops names, patterns, matching values and undefined entries', () => {
    const env = { KEEP: '1', SECRET_TOKEN: 'x', APP_KEY: 'tok_live_123', GONE: undefined, OTHER: 'y' };
    expect(scrubEnv(env, { names: [/TOKEN$/, 'OTHER'], values: [/^tok_live_/] })).toEqual({ KEEP: '1' });
  });

  it('handles global and sticky patterns on every variable', () => {
    const env = { KEY_FIRST: '1', KEY_SECOND: '2', A: 'sk-1', B: 'sk-2', KEEP: 'x' };
    expect(scrubEnv(env, { names: [/^KEY_/g], values: [/^sk-/y] })).toEqual({ KEEP: 'x' });
  });

  it('removes provider credentials only', () => {
    expect(withoutProviderCredentials({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'b', PATH: '/bin' })).toEqual({
      PATH: '/bin',
    });
  });
});
