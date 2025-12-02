import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSystemPrompt } from './systemprompt.js';
import '../cli/cli-params.js';
import '../files/find-files.js';
import '../main/config.js';

vi.mock('../cli/cli-params.js', () => ({
  disableExplanations: true,
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
  importantContext: {},
}));

describe('getSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates correct system prompt', () => {
    const systemPrompt = getSystemPrompt({ rootDir: '/mocked/root/dir' }, { askQuestion: false });

    expect(systemPrompt).toContain('You are GenAIcode, a code generation assistant');
    expect(systemPrompt).toContain('Target Root Directory (ROOT_DIR): `/mocked/root/dir`');
    expect(systemPrompt).toContain('## CORE GUIDELINES');
    expect(systemPrompt).toContain('## PERMISSIONS');
    expect(systemPrompt).toContain('## CONFIGURATION');
  });

  it('verifies system prompt limit', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const systemPrompt = getSystemPrompt({ rootDir: '/mocked/root/dir' }, { verbose: true, askQuestion: false });

    // Verify that console.log was called with 'Generate system prompt'
    expect(consoleSpy).toHaveBeenCalledWith('Generate system prompt');

    // Verify that when verbose is true, the system prompt is logged
    expect(consoleSpy).toHaveBeenCalledWith('System prompt:', expect.stringContaining('You are GenAIcode'));

    // Verify the system prompt contains expected content
    expect(systemPrompt).toContain('You are GenAIcode, a code generation assistant');

    consoleSpy.mockRestore();
  });
});
