/*eslint-disable no-import-assign*/

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promptService } from './prompt-service.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as chatGpt from '../ai-service/chat-gpt.js';
import * as anthropic from '../ai-service/anthropic.js';
import * as cliParams from '../cli/cli-params.js';
import fs from 'fs';
import * as diff from 'diff';

vi.mock('../ai-service/vertex-ai.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/chat-gpt.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/anthropic.js', () => ({ generateContent: vi.fn() }));
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
  disableContextOptimization: false,
}));
vi.mock('fs');
vi.mock('diff');

// Mock find-files module
vi.mock('../files/find-files.js', () => ({
  rootDir: '/mocked/root/dir',
  rcConfig: {
    rootDir: '.',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
  },
  getSourceFiles: () => [],
}));

describe('promptService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cliParams.anthropic = false;
    cliParams.chatGpt = false;
    cliParams.vertexAi = false;
    cliParams.dryRun = false;
  });

  it('should process the codegen summary and return the result with Vertex AI', async () => {
    cliParams.vertexAi = true;
    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Hello");' } },
    ];
    vertexAi.generateContent.mockResolvedValueOnce(mockFunctionCalls);

    const result = await promptService(vertexAi.generateContent);

    expect(result).toEqual(mockFunctionCalls);
    expect(vertexAi.generateContent).toHaveBeenCalled();
  });

  it('should process the codegen summary and return the result with ChatGPT', async () => {
    cliParams.chatGpt = true;
    const mockFunctionCalls = [{ name: 'createFile', args: { filePath: 'new.js', newContent: 'const x = 5;' } }];
    chatGpt.generateContent.mockResolvedValueOnce(mockFunctionCalls);

    const result = await promptService(chatGpt.generateContent);

    expect(result).toEqual(mockFunctionCalls);
    expect(chatGpt.generateContent).toHaveBeenCalled();
  });

  it('should process the codegen summary and return the result with Anthropic', async () => {
    cliParams.anthropic = true;
    const mockFunctionCalls = [{ name: 'deleteFile', args: { filePath: 'obsolete.js' } }];
    anthropic.generateContent.mockResolvedValueOnce(mockFunctionCalls);

    const result = await promptService(anthropic.generateContent);

    expect(result).toEqual(mockFunctionCalls);
    expect(anthropic.generateContent).toHaveBeenCalled();
  });

  it('should not update files in dry run mode', async () => {
    cliParams.vertexAi = true;
    cliParams.dryRun = true;
    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Dry run");' } },
    ];
    vertexAi.generateContent.mockResolvedValueOnce(mockFunctionCalls);

    const result = await promptService(vertexAi.generateContent);

    expect(result).toEqual(mockFunctionCalls);
    expect(vertexAi.generateContent).toHaveBeenCalled();
  });

  it('should handle invalid patchFile call and retry without patchFile function', async () => {
    cliParams.vertexAi = true;
    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          filePaths: ['test.js'],
          contextPaths: [],
          explanation: 'Mock summary',
        },
      },
    ];
    const mockInvalidPatchCall = [
      {
        name: 'patchFile',
        args: {
          filePath: 'test.js',
          patch: 'invalid patch',
        },
      },
    ];
    const mockValidUpdateCall = [
      {
        name: 'updateFile',
        args: {
          filePath: 'test.js',
          newContent: 'console.log("Updated content");',
        },
      },
    ];

    // Mock the first call to return the codegen summary
    vertexAi.generateContent.mockResolvedValueOnce(mockCodegenSummary);
    // Mock the second call to return an invalid patch
    vertexAi.generateContent.mockResolvedValueOnce(mockInvalidPatchCall);
    // Mock the third call (retry) to return a valid update
    vertexAi.generateContent.mockResolvedValueOnce(mockValidUpdateCall);

    // Mock fs.readFileSync to return some content
    fs.readFileSync.mockReturnValue('Original content');

    // Mock diff.applyPatch to fail for the invalid patch
    diff.applyPatch.mockReturnValue(false);

    const result = await promptService(vertexAi.generateContent);

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    expect(fs.readFileSync).toHaveBeenCalledWith('test.js', 'utf-8');
    expect(diff.applyPatch).toHaveBeenCalledWith('Original content', 'invalid patch');
    expect(result).toEqual(mockValidUpdateCall);
  });
});
