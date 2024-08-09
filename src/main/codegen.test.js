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
import * as cliOptions from '../cli/cli-options.js';
import * as vertexAiImagen from '../ai-service/vertex-ai-imagen.js';
import * as dallE from '../ai-service/dall-e.js';
import './config.js';

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
  helpRequested: false,
  vision: false,
  imagen: false,
  temperature: 0.7,
  cheap: false,
  taskFile: undefined,
  disableInitialLint: undefined,
}));
vi.mock('../files/find-files.js', () => ({
  getSourceFiles: () => [],
  getImageAssetFiles: () => [],
}));
vi.mock('../cli/cli-options.js', () => ({
  printHelpMessage: vi.fn(),
}));
vi.mock('../ai-service/vertex-ai-imagen.js', () => ({ generateImage: vi.fn() }));
vi.mock('../ai-service/dall-e.js', () => ({ generateImage: vi.fn() }));
vi.mock('./config.js', () => ({
  rootDir: '/mocked/root/dir',
  rcConfig: {
    rootDir: '.',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
  },
}));

describe('runCodegen', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cliParams.anthropic = false;
    cliParams.chatGpt = false;
    cliParams.vertexAi = false;
    cliParams.vertexAiClaude = false;
    cliParams.dryRun = false;
    cliParams.helpRequested = false;
    cliParams.vision = false;
    cliParams.imagen = false;
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

  it('should pass the temperature parameter to the AI service', async () => {
    cliParams.vertexAi = true;
    cliParams.temperature = 0.5;

    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Temperature test");' } },
    ];
    vertexAi.generateContent.mockResolvedValueOnce(mockFunctionCalls);

    await runCodegen();

    expect(vertexAi.generateContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      0.5,
      false,
    );
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls);
  });

  it('should print help message and not run codegen when --help option is provided', async () => {
    cliParams.helpRequested = true;

    await runCodegen();

    expect(cliOptions.printHelpMessage).toHaveBeenCalled();
    expect(vertexAi.generateContent).not.toHaveBeenCalled();
    expect(chatGpt.generateContent).not.toHaveBeenCalled();
    expect(anthropic.generateContent).not.toHaveBeenCalled();
    expect(vertexAiClaude.generateContent).not.toHaveBeenCalled();
    expect(updateFiles.updateFiles).not.toHaveBeenCalled();
  });

  it('should run codegen with vision when vision flag is true', async () => {
    cliParams.chatGpt = true;
    cliParams.vision = true;

    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Vision test");' } },
    ];
    chatGpt.generateContent.mockResolvedValueOnce(mockFunctionCalls);

    await runCodegen();

    expect(chatGpt.generateContent).toHaveBeenCalled();
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls);
    // Check if the generateContent function was called with the correct parameters
    expect(chatGpt.generateContent.mock.calls[0][0]).toEqual(
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
          functionResponses: [{ name: 'getImageAssets', content: expect.any(String) }],
        }),
      ]),
    );
  });

  it('should use Vertex AI Imagen when imagen flag is set to vertex-ai', async () => {
    cliParams.imagen = 'vertex-ai';
    cliParams.vertexAi = true;

    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [{ path: 'test.js', updateToolName: 'updateFile' }],
          contextPaths: [],
          explanation: 'Mock summary with image generation failure',
        },
      },
    ];
    const mockFunctionCalls = [
      { name: 'generateImage', args: { prompt: 'A beautiful landscape', filePath: 'landscape.png', size: '512x512' } },
    ];
    vertexAi.generateContent.mockResolvedValueOnce(mockCodegenSummary);
    vertexAi.generateContent.mockResolvedValueOnce(mockFunctionCalls);
    vertexAiImagen.generateImage.mockResolvedValueOnce('mocked-image-data');

    await runCodegen();

    expect(vertexAi.generateContent).toHaveBeenCalled();
    expect(vertexAiImagen.generateImage).toHaveBeenCalledWith('A beautiful landscape', undefined, '512x512', false);
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls);
  });

  it('should use DALL-E when imagen flag is set to dall-e', async () => {
    cliParams.imagen = 'dall-e';
    cliParams.chatGpt = true;

    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [{ path: 'test.js', updateToolName: 'updateFile' }],
          contextPaths: [],
          explanation: 'Mock summary with image generation failure',
        },
      },
    ];
    const mockFunctionCalls = [
      { name: 'generateImage', args: { prompt: 'A futuristic city', filePath: 'city.png', size: '1024x1024' } },
    ];
    chatGpt.generateContent.mockResolvedValueOnce(mockCodegenSummary);
    chatGpt.generateContent.mockResolvedValueOnce(mockFunctionCalls);
    dallE.generateImage.mockResolvedValueOnce('mocked-image-data');

    await runCodegen();

    expect(chatGpt.generateContent).toHaveBeenCalled();
    expect(dallE.generateImage).toHaveBeenCalledWith('A futuristic city', undefined, '1024x1024', false);
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls);
  });

  it('should throw an error when imagen flag is set but no AI service is specified', async () => {
    cliParams.imagen = 'vertex-ai';

    await expect(runCodegen()).rejects.toThrow('Please specify which AI service should be used');
  });

  it('should pass the cheap parameter to the AI service when --cheap flag is true', async () => {
    cliParams.vertexAi = true;
    cliParams.cheap = true;

    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Cheap test");' } },
    ];
    vertexAi.generateContent.mockResolvedValueOnce(mockFunctionCalls);

    await runCodegen();

    expect(vertexAi.generateContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
    );
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls);
  });

  it('should pass the cheap parameter to the image generation service when --cheap flag is true', async () => {
    cliParams.imagen = 'vertex-ai';
    cliParams.vertexAi = true;
    cliParams.cheap = true;

    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [{ path: 'test.js', updateToolName: 'updateFile' }],
          contextPaths: [],
          explanation: 'Mock summary with cheap image generation',
        },
      },
    ];
    const mockFunctionCalls = [
      {
        name: 'generateImage',
        args: {
          prompt: 'A simple landscape',
          filePath: 'landscape.png',
          size: { width: 256, height: 256 },
          cheap: true,
        },
      },
    ];
    vertexAi.generateContent.mockResolvedValueOnce(mockCodegenSummary);
    vertexAi.generateContent.mockResolvedValueOnce(mockFunctionCalls);
    vertexAiImagen.generateImage.mockResolvedValueOnce('mocked-cheap-image-data');

    await runCodegen();

    expect(vertexAi.generateContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
    );
    expect(vertexAiImagen.generateImage).toHaveBeenCalledWith(
      'A simple landscape',
      undefined,
      { width: 256, height: 256 },
      true,
    );
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls);
  });
});
