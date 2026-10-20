import { describe, expect, it, vi } from 'vitest';
import { defaultAppAgents } from './policy.js';
import { copilot } from '../agents/drivers/copilot.js';

vi.mock('../agents/drivers/copilot.js', async (original) => {
  const actual = await original<typeof import('../agents/drivers/copilot.js')>();
  return { ...actual, copilot: vi.fn(actual.copilot) };
});

describe('defaultAppAgents', () => {
  it('lets Copilot run each dev command with arguments, and never commit or push', () => {
    defaultAppAgents('dev', ['npm test']);
    const options = vi.mocked(copilot).mock.calls.at(-1)?.[0];
    expect(options?.allowTools).toEqual(['write', 'shell(npm test)', 'shell(npm test:*)']);
    expect(options?.denyTools).toEqual([
      'shell(git commit)',
      'shell(git commit:*)',
      'shell(git push)',
      'shell(git push:*)',
    ]);
  });
});
