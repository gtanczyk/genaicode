import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSystemPrompt } from './systemprompt.ts';
import * as cliParams from '../cli/cli-params.ts';
import '../files/find-files.ts';
import '../main/config.ts';

vi.mock('../cli/cli-params.ts', () => ({
  requireExplanations: false,
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

vi.mock('../files/find-files.ts', () => ({
  getSourceFiles: vi.fn(),
}));

vi.mock('../main/config.ts', () => ({
  rcConfig: { rootDir: '/mocked/root/dir' },
}));

describe('getSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates correct system prompt', () => {
    const systemPrompt = getSystemPrompt();

    expect(systemPrompt).toContain(
      'You are a code generation assistant. I want you to help me generate code for my ideas in my application source code.',
    );
    expect(systemPrompt).toContain('You can generate new code, or modify the existing one.');
    expect(systemPrompt).toContain(
      'Instructions will be passed to you either directly via message, with a file, or using the ' +
        '@' +
        'CODEGEN comment in the code.',
    );
    expect(systemPrompt).toContain(
      'The root directory of my application is `/mocked/root/dir` and you should limit the changes only to this path.',
    );
    expect(systemPrompt).toContain('When suggesting changes always use absolute file paths.');
  });

  it('verifies system prompt limit', () => {
    vi.spyOn(cliParams, 'verbosePrompt', 'get').mockReturnValue(true);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    getSystemPrompt();

    expect(consoleSpy).toHaveBeenCalledWith('System prompt:');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('You are a code generation assistant. I want you to help me generate code for my ideas'),
    );

    consoleSpy.mockRestore();
  });
});
