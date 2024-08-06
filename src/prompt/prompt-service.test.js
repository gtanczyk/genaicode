/*eslint-disable no-import-assign*/

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promptService } from './prompt-service.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as cliParams from '../cli/cli-params.js';
import fs from 'fs';
import * as diff from 'diff';
import mime from 'mime-types';
import { getImageAssets } from '../files/read-files.js';
import '../files/find-files.js';

vi.mock('../ai-service/vertex-ai.js', () => ({ generateContent: vi.fn() }));
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
  vision: false,
  imagen: false,
  temperature: 0.7,
}));
vi.mock('fs');
vi.mock('diff');
vi.mock('mime-types');

// Mock find-files module
vi.mock('../files/find-files.js', () => ({
  rootDir: '/mocked/root/dir',
  rcConfig: {
    rootDir: '.',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
  },
  getSourceFiles: () => [],
  getImageAssetFiles: () => [],
}));

// Mock read-files module
vi.mock('../files/read-files.js', () => ({
  getSourceCode: () => ({}),
  getImageAssets: vi.fn(() => ({})),
}));

describe('promptService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cliParams.vertexAi = false;
    cliParams.dryRun = false;
    cliParams.vision = false;
    cliParams.imagen = false;
    cliParams.disableContextOptimization = false;
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
          files: [{ path: 'test.js', updateToolName: 'patchFile' }],
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

  it('should not include image assets when vision flag is false', async () => {
    cliParams.vertexAi = true;
    cliParams.vision = false;
    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("No vision test");' } },
    ];

    vertexAi.generateContent.mockResolvedValueOnce(mockFunctionCalls);

    await promptService(vertexAi.generateContent);

    expect(vertexAi.generateContent).toHaveBeenCalled();
    const calls = vertexAi.generateContent.mock.calls[0];
    expect(calls[0]).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'user',
          text: expect.stringContaining('I should also provide you with a summary of application image assets'),
        }),
      ]),
    );
  });

  it('should handle context optimization', async () => {
    cliParams.vertexAi = true;
    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          files: [{ path: 'test.js', updateToolName: 'updateFile' }],
          contextPaths: ['context1.js', 'context2.js'],
          explanation: 'Mock summary with context',
        },
      },
    ];
    const mockUpdateCall = [
      {
        name: 'updateFile',
        args: {
          filePath: 'test.js',
          newContent: 'console.log("Updated with context");',
        },
      },
    ];

    vertexAi.generateContent.mockResolvedValueOnce(mockCodegenSummary);
    vertexAi.generateContent.mockResolvedValueOnce(mockUpdateCall);

    await promptService(vertexAi.generateContent);

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(2);
    const firstCall = vertexAi.generateContent.mock.calls[0];
    expect(firstCall[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'user',
          functionResponses: [
            expect.objectContaining({
              name: 'getSourceCode',
              content: expect.any(String),
            }),
          ],
        }),
      ]),
    );
  });

  it('should handle disableContextOptimization flag', async () => {
    cliParams.vertexAi = true;
    cliParams.disableContextOptimization = true;
    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          files: [{ path: 'test.js', updateToolName: 'updateFile' }],
          contextPaths: ['context1.js', 'context2.js'],
          explanation: 'Mock summary without context optimization',
        },
      },
    ];
    const mockUpdateCall = [
      {
        name: 'updateFile',
        args: {
          filePath: 'test.js',
          newContent: 'console.log("Updated without context optimization");',
        },
      },
    ];

    vertexAi.generateContent.mockResolvedValueOnce(mockCodegenSummary);
    vertexAi.generateContent.mockResolvedValueOnce(mockUpdateCall);

    await promptService(vertexAi.generateContent);

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(2);
    const firstCall = vertexAi.generateContent.mock.calls[0];
    expect(firstCall[0]).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'user',
          functionResponses: [
            expect.objectContaining({
              name: 'getSourceCode',
              content: expect.stringContaining('context1.js'),
            }),
          ],
        }),
      ]),
    );
  });

  it('should handle unexpected response without codegen summary', async () => {
    cliParams.vertexAi = true;
    const mockUnexpectedResponse = [
      {
        name: 'updateFile',
        args: {
          filePath: 'test.js',
          newContent: 'console.log("Unexpected response");',
        },
      },
    ];

    vertexAi.generateContent.mockResolvedValueOnce(mockUnexpectedResponse);

    const result = await promptService(vertexAi.generateContent);

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockUnexpectedResponse);
  });
});
