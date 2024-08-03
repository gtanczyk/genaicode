/*eslint-disable no-import-assign*/

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runCodegen } from './codegen.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as chatGpt from '../ai-service/chat-gpt.js';
import * as anthropic from '../ai-service/anthropic.js';
import * as vertexAiClaude from '../ai-service/vertex-ai-claude.js';
import * as updateFiles from '../files/update-files.js';
import '../files/find-files.js';
import * as cliParams from '../cli/cli-params.js';

vi.mock('../ai-service/vertex-ai.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/chat-gpt.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/anthropic.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/vertex-ai-claude.js', () => ({ generateContent: vi.fn() }));
vi.mock('../files/update-files.js');
vi.mock('../cli/cli-params.js', () => ({
  requireExplanations: false,
  considerAllFiles: false,
  dependencyTree: false,
  explicitPrompt: false,
  allowFileCreate: false,
  allowFileDelete: false,
  allowDirectoryCreate: false,
  allowFileMove: false,
  verbosePrompt: false,
  vertexAiClaude: false,
}));
vi.mock('../files/find-files.js', () => ({
  rootDir: '/mocked/root/dir',
  rcConfig: {
    rootDir: '.',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
  },
  getSourceFiles: () => [],
}));

describe('runCodegen', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cliParams.anthropic = false;
    cliParams.chatGpt = false;
    cliParams.vertexAi = false;
    cliParams.vertexAiClaude = false;
    cliParams.dryRun = false;
  });

  it('should run codegen with Vertex AI by default', async () => {
    cliParams.vertexAi = true;

    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Hello");' } },
    ];
    vertexAi.generateContent.mockResolvedValueOnce(mockFunctionCalls);

    await runCodegen();

    expect(vertexAi.generateContent).toHaveBeenCalled();
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls);
  });

  it('should run codegen with ChatGPT when chatGpt flag is true', async () => {
    cliParams.chatGpt = true;

    const mockFunctionCalls = [{ name: 'createFile', args: { filePath: 'new.js', newContent: 'const x = 5;' } }];
    chatGpt.generateContent.mockResolvedValueOnce(mockFunctionCalls);

    await runCodegen();

    expect(chatGpt.generateContent).toHaveBeenCalled();
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls);
  });

  it('should run codegen with Anthropic when anthropic flag is true', async () => {
    cliParams.anthropic = true;

    const mockFunctionCalls = [{ name: 'deleteFile', args: { filePath: 'obsolete.js' } }];
    anthropic.generateContent.mockResolvedValueOnce(mockFunctionCalls);

    await runCodegen();

    expect(anthropic.generateContent).toHaveBeenCalled();
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls);
  });

  it('should not update files in dry run mode', async () => {
    cliParams.vertexAi = true;
    cliParams.dryRun = true;

    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Dry run");' } },
    ];
    vertexAi.generateContent.mockResolvedValueOnce(mockFunctionCalls);

    await runCodegen();

    expect(vertexAi.generateContent).toHaveBeenCalled();
    expect(updateFiles.updateFiles).not.toHaveBeenCalled();
  });

  it('should run codegen with Vertex AI Claude when vertexAiClaude flag is true', async () => {
    cliParams.vertexAiClaude = true;

    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Hello from Claude");' } },
    ];
    vertexAiClaude.generateContent.mockResolvedValueOnce(mockFunctionCalls);

    await runCodegen();

    expect(vertexAiClaude.generateContent).toHaveBeenCalled();
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls);
  });
});
