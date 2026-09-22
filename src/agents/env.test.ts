import { describe, expect, it } from 'vitest';
import { scrubEnv, withoutProviderCredentials } from './env.js';

describe('env scrubbing', () => {
  it('drops names, patterns, matching values and undefined entries', () => {
    const env = { KEEP: '1', SECRET_TOKEN: 'x', APP_KEY: 'tok_live_123', GONE: undefined, OTHER: 'y' };
    expect(scrubEnv(env, { names: [/TOKEN$/, 'OTHER'], values: [/^tok_live_/] })).toEqual({ KEEP: '1' });
  });

  it('removes provider credentials only', () => {
    expect(withoutProviderCredentials({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'b', PATH: '/bin' })).toEqual({
      PATH: '/bin',
    });
  });
});
