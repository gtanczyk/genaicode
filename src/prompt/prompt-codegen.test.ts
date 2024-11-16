import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCodeGenPrompt, getLintFixPrompt } from './prompt-codegen.js';
import * as findFiles from '../files/find-files.js';
import * as cliParams from '../cli/cli-params.js';
import * as limits from './limits.js';
import '../files/read-files.js';

vi.mock('../files/find-files.js', () => ({
  rcConfig: {},
  getSourceFiles: vi.fn(),
}));
vi.mock('../files/read-files.js', () => ({
  getSourceCode: () => ({}),
}));
vi.mock('../cli/cli-params.js', () => ({
  disableExplanations: true,
  cliExplicitPrompt: false,
  allowFileCreate: false,
  allowFileDelete: false,
  allowDirectoryCreate: false,
  allowFileMove: false,
  verbosePrompt: false,
  imagen: false,
  vision: false,
}));
vi.mock('./limits.js');

describe('getCodeGenPrompt', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should generate prompt for all files', () => {
    vi.spyOn(findFiles, 'getSourceFiles').mockReturnValue(['file1.js', 'file2.js']);
    vi.mocked(cliParams).explicitPrompt = undefined;
    vi.mocked(cliParams).allowFileCreate = false;
    vi.mocked(cliParams).allowFileDelete = false;
    vi.mocked(cliParams).allowDirectoryCreate = false;
    vi.mocked(cliParams).allowFileMove = false;
    vi.spyOn(limits, 'verifyCodegenPromptLimit').mockImplementation(() => 0); // Return 0 instead of void

    const prompt = getCodeGenPrompt({
      aiService: 'vertex-ai',
      temperature: 0.7,
      cheap: false,
      explicitPrompt: 'testx',
      askQuestion: false,
    }).prompt;

    expect(prompt).toContain('testx');
  });

  // Add more test cases for getCodeGenPrompt as needed
});

describe('getLintFixPrompt', () => {
  beforeEach(() => {
    vi.mocked(cliParams).verbosePrompt = false;
    vi.spyOn(limits, 'verifyCodegenPromptLimit').mockImplementation(() => 0); // Return 0 instead of void
  });

  it('should generate a lint fix prompt with provided command, stdout, and stderr', () => {
    const command = 'eslint --fix';
    const stdout = 'Fixed 2 errors';
    const stderr = '';

    const prompt = getLintFixPrompt(command, { aiService: 'vertex-ai', askQuestion: false }, stdout, stderr);

    expect(prompt).toContain('The following lint errors were encountered after the initial code generation:');
    expect(prompt).toContain(`Lint command: ${command}`);
    expect(prompt).toContain('Lint command stdout:');
    expect(prompt).toContain(stdout);
    expect(prompt).toContain('Lint command stderr:');
    expect(prompt).toContain('Please suggest changes to fix these lint errors.');
  });

  it('should include stderr in the prompt when provided', () => {
    const command = 'eslint --fix';
    const stdout = '';
    const stderr = 'Error: Unable to resolve path';

    const prompt = getLintFixPrompt(command, { aiService: 'vertex-ai', askQuestion: false }, stdout, stderr);

    expect(prompt).toContain('Lint command stderr:');
    expect(prompt).toContain(stderr);
  });

  it('should call verifyCodegenPromptLimit with the generated prompt', () => {
    const command = 'eslint --fix';
    const stdout = 'Fixed 1 error';
    const stderr = '';

    getLintFixPrompt(command, { aiService: 'vertex-ai', askQuestion: false }, stdout, stderr);

    expect(limits.verifyCodegenPromptLimit).toHaveBeenCalledWith(expect.any(String));
  });

  it('should log the prompt when verbosePrompt is true', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const command = 'eslint --fix';
    const stdout = 'Fixed 1 error';
    const stderr = '';

    getLintFixPrompt(command, { aiService: 'vertex-ai', verbose: true, askQuestion: false }, stdout, stderr);

    expect(consoleSpy).toHaveBeenCalledWith('Lint fix prompt:');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('The following lint errors were encountered'));

    consoleSpy.mockRestore();
  });
});
