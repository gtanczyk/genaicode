import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSystemPrompt } from './systemprompt.js';
import '../cli/cli-params.js';
import '../files/find-files.js';
import '../main/config.js';

vi.mock('../cli/cli-params.js', () => ({
  disableExplanations: true,
  considerAllFiles: false,
  dependencyTree: false,
  explicitPrompt: false,
  allowFileCreate: false,
  allowFileDelete: false,
  allowDirectoryCreate: false,
  allowFileMove: false,
  verbosePrompt: false,
  askQuestion: false,
}));

vi.mock('../files/find-files.js', () => ({
  getSourceFiles: vi.fn(),
}));

vi.mock('../main/config.js', () => ({
  rcConfig: { rootDir: '/mocked/root/dir' },
}));

describe('getSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates correct system prompt', () => {
    const systemPrompt = getSystemPrompt({ aiService: 'vertex-ai' });

    expect(systemPrompt).toContain('You are GenAIcode, a code generation assistant');
    expect(systemPrompt).toContain('You can generate new code or modify existing');
    expect(systemPrompt).toContain(
      'Please limit any changes to the root directory of my application, which is `/mocked/root/dir`',
    );
    expect(systemPrompt).toContain('absolute file paths exactly');
  });

  it('verifies system prompt limit', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    getSystemPrompt({ aiService: 'vertex-ai', verbose: true });

    expect(consoleSpy).toHaveBeenCalledWith('System prompt:');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('You are GenAIcode, a code generation assistant'));

    consoleSpy.mockRestore();
  });
});
