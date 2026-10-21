import { describe, expect, it, vi } from 'vitest';
import { defaultAppAgents } from './policy.js';
import { copilot } from '../agents/drivers/copilot.js';
import { codex } from '../agents/drivers/codex.js';
import { claude } from '../agents/drivers/claude.js';

vi.mock('../agents/drivers/copilot.js', async (original) => {
  const actual = await original<typeof import('../agents/drivers/copilot.js')>();
  return { ...actual, copilot: vi.fn(actual.copilot) };
});

vi.mock('../agents/drivers/codex.js', async (original) => {
  const actual = await original<typeof import('../agents/drivers/codex.js')>();
  return { ...actual, codex: vi.fn(actual.codex) };
});

vi.mock('../agents/drivers/claude.js', async (original) => {
  const actual = await original<typeof import('../agents/drivers/claude.js')>();
  return { ...actual, claude: vi.fn(actual.claude) };
});

describe('defaultAppAgents', () => {
  it('takes web tools and Codex apps away in use mode', () => {
    defaultAppAgents('use');
    expect(vi.mocked(copilot).mock.calls.at(-1)?.[0]?.excludedTools).toEqual(['web_fetch', 'web_search']);
    expect(vi.mocked(codex).mock.calls.at(-1)?.[0]?.config).toMatchObject({ 'features.apps': false });
    expect(vi.mocked(claude).mock.calls.at(-1)?.[0]?.settings).toEqual({ disableAllHooks: true });
    defaultAppAgents('dev');
    expect(vi.mocked(codex).mock.calls.at(-1)?.[0]?.config).toMatchObject({ 'features.apps': false });
  });

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
