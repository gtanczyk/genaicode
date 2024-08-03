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
vi.mock('../cli/cli-params.js');
vi.mock('./limits.js');

describe('getCodeGenPrompt', () => {
  it('should generate prompt for all files when considerAllFiles is true', () => {
    vi.spyOn(findFiles, 'getSourceFiles').mockReturnValue(['file1.js', 'file2.js']);
    vi.spyOn(cliParams, 'considerAllFiles', 'get').mockReturnValue(true);
    vi.spyOn(cliParams, 'explicitPrompt', 'get').mockReturnValue(null);
    vi.spyOn(cliParams, 'allowFileCreate', 'get').mockReturnValue(false);
    vi.spyOn(cliParams, 'allowFileDelete', 'get').mockReturnValue(false);
    vi.spyOn(cliParams, 'allowDirectoryCreate', 'get').mockReturnValue(false);
    vi.spyOn(cliParams, 'allowFileMove', 'get').mockReturnValue(false);
    vi.spyOn(limits, 'verifyCodegenPromptLimit').mockImplementation(() => {});

    const prompt = getCodeGenPrompt();

    expect(prompt).toContain('You are allowed to modify all files in the application');
    expect(prompt).toContain('Do not create new files.');
    expect(prompt).toContain('Do not delete files.');
    expect(prompt).toContain('Do not create new directories.');
    expect(prompt).toContain('Do not move files.');
  });

  // Add more test cases for getCodeGenPrompt as needed
});

describe('getLintFixPrompt', () => {
  beforeEach(() => {
    vi.spyOn(cliParams, 'verbosePrompt', 'get').mockReturnValue(false);
    vi.spyOn(limits, 'verifyCodegenPromptLimit').mockImplementation(() => {});
  });

  it('should generate a lint fix prompt with provided command, stdout, and stderr', () => {
    const command = 'eslint --fix';
    const stdout = 'Fixed 2 errors';
    const stderr = '';

    const prompt = getLintFixPrompt(command, stdout, stderr);

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

    const prompt = getLintFixPrompt(command, stdout, stderr);

    expect(prompt).toContain('Lint command stderr:');
    expect(prompt).toContain(stderr);
  });

  it('should call verifyCodegenPromptLimit with the generated prompt', () => {
    const command = 'eslint --fix';
    const stdout = 'Fixed 1 error';
    const stderr = '';

    getLintFixPrompt(command, stdout, stderr);

    expect(limits.verifyCodegenPromptLimit).toHaveBeenCalledWith(expect.any(String));
  });

  it('should log the prompt when verbosePrompt is true', () => {
    vi.spyOn(cliParams, 'verbosePrompt', 'get').mockReturnValue(true);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const command = 'eslint --fix';
    const stdout = 'Fixed 1 error';
    const stderr = '';

    getLintFixPrompt(command, stdout, stderr);

    expect(consoleSpy).toHaveBeenCalledWith('Lint fix prompt:');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('The following lint errors were encountered'));

    consoleSpy.mockRestore();
  });
});