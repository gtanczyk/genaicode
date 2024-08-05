/*eslint-disable no-import-assign*/

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promptService } from './prompt-service.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as chatGpt from '../ai-service/chat-gpt.js';
import * as anthropic from '../ai-service/anthropic.js';
import * as cliParams from '../cli/cli-params.js';
import fs from 'fs';
import * as diff from 'diff';
import mime from 'mime-types';
import { getImageAssets } from '../files/read-files.js';
import '../files/find-files.js';
import * as dalleService from '../ai-service/dall-e.js';

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
  vision: false,
  imagen: false,
  temperature: 0.7,
}));
vi.mock('fs');
vi.mock('diff');
vi.mock('mime-types');
vi.mock('../ai-service/dall-e.js', () => ({ generateImage: vi.fn() }));

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
    cliParams.anthropic = false;
    cliParams.chatGpt = false;
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

  it('should include image assets when vision flag is true', async () => {
    cliParams.chatGpt = true;
    cliParams.vision = true;
    const mockImageAssets = {
      '/path/to/image1.png': { width: 100, height: 100 },
      '/path/to/image2.jpg': { width: 200, height: 200 },
    };
    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Vision test");' } },
    ];

    getImageAssets.mockReturnValue(mockImageAssets);
    chatGpt.generateContent.mockResolvedValueOnce(mockFunctionCalls);

    await promptService(chatGpt.generateContent);

    expect(chatGpt.generateContent).toHaveBeenCalled();
    const calls = chatGpt.generateContent.mock.calls[0];
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'user',
          text: expect.stringContaining('I should also provide you with a summary of application image assets'),
        }),
        expect.objectContaining({
          type: 'assistant',
          text: expect.stringContaining('Please provide summary of application image assets.'),
        }),
        expect.objectContaining({
          type: 'user',
          functionResponses: [{ name: 'getImageAssets', content: JSON.stringify(mockImageAssets) }],
        }),
      ]),
    );
  });

  it('should include image data in the prompt when processing files with vision', async () => {
    cliParams.chatGpt = true;
    cliParams.vision = true;
    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          files: [
            {
              path: 'test.js',
              updateToolName: 'updateFile',
              contextImageAssets: ['/path/to/image1.png', '/path/to/image2.jpg'],
            },
          ],
          contextPaths: [],
          explanation: 'Mock summary',
        },
      },
    ];
    const mockUpdateCall = [
      {
        name: 'updateFile',
        args: {
          filePath: 'test.js',
          newContent: 'console.log("Updated with vision");',
        },
      },
    ];

    chatGpt.generateContent.mockResolvedValueOnce(mockCodegenSummary);
    chatGpt.generateContent.mockResolvedValueOnce(mockUpdateCall);

    fs.readFileSync.mockImplementation((path) => `mock-base64-data-for-${path}`);
    mime.lookup.mockImplementation((path) => (path.endsWith('.png') ? 'image/png' : 'image/jpeg'));

    await promptService(chatGpt.generateContent);

    expect(chatGpt.generateContent).toHaveBeenCalledTimes(2);
    const secondCall = chatGpt.generateContent.mock.calls[1];
    expect(secondCall[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'user',
          text: expect.stringContaining('suggest changes for the `test.js` file'),
          images: [
            {
              path: '/path/to/image1.png',
              base64url: 'mock-base64-data-for-/path/to/image1.png',
              mediaType: 'image/png',
            },
            {
              path: '/path/to/image2.jpg',
              base64url: 'mock-base64-data-for-/path/to/image2.jpg',
              mediaType: 'image/jpeg',
            },
          ],
        }),
      ]),
    );
  });

  it('should not include image assets when vision flag is false', async () => {
    cliParams.chatGpt = true;
    cliParams.vision = false;
    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("No vision test");' } },
    ];

    chatGpt.generateContent.mockResolvedValueOnce(mockFunctionCalls);

    await promptService(chatGpt.generateContent);

    expect(chatGpt.generateContent).toHaveBeenCalled();
    const calls = chatGpt.generateContent.mock.calls[0];
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

  it('should handle image generation requests', async () => {
    cliParams.vertexAi = true;
    cliParams.imagen = true;
    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          files: [{ path: 'test.js', updateToolName: 'updateFile' }],
          contextPaths: [],
          explanation: 'Mock summary with image generation',
        },
      },
    ];
    const mockGenerateImageCall = [
      {
        name: 'generateImage',
        args: {
          prompt: 'A test image',
          filePath: '/path/to/generated/image.png',
          size: '256x256',
        },
      },
    ];
    const mockDownloadFileCall = [
      {
        name: 'downloadFile',
        args: {
          filePath: '/path/to/generated/image.png',
          explanation: 'Downloading generated image',
          downloadUrl: 'https://example.com/generated-image.png',
        },
      },
    ];

    vertexAi.generateContent.mockResolvedValueOnce(mockCodegenSummary);
    vertexAi.generateContent.mockResolvedValueOnce(mockGenerateImageCall);
    dalleService.generateImage.mockResolvedValue('https://example.com/generated-image.png');

    const result = await promptService(vertexAi.generateContent);

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(2);
    expect(dalleService.generateImage).toHaveBeenCalledWith('A test image', '256x256');
    expect(result).toEqual(expect.arrayContaining(mockDownloadFileCall));
  });

  it('should handle image generation failure', async () => {
    cliParams.vertexAi = true;
    cliParams.imagen = true;
    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          files: [{ path: 'test.js', updateToolName: 'updateFile' }],
          contextPaths: [],
          explanation: 'Mock summary with image generation failure',
        },
      },
    ];
    const mockGenerateImageCall = [
      {
        name: 'generateImage',
        args: {
          prompt: 'A test image',
          filePath: '/path/to/generated/image.png',
          size: '256x256',
        },
      },
    ];

    vertexAi.generateContent.mockResolvedValueOnce(mockCodegenSummary);
    vertexAi.generateContent.mockResolvedValueOnce(mockGenerateImageCall);
    dalleService.generateImage.mockRejectedValue(new Error('Image generation failed'));

    const result = await promptService(vertexAi.generateContent);

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(2);
    expect(dalleService.generateImage).toHaveBeenCalledWith('A test image', '256x256');
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'explanation',
          args: {
            text: expect.stringContaining('Failed to generate image: Image generation failed'),
          },
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
