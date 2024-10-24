import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runCodegen } from './codegen.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as chatGpt from '../ai-service/chat-gpt.js';
import * as anthropic from '../ai-service/anthropic.js';
import * as vertexAiClaude from '../ai-service/vertex-ai-claude.js';
import * as updateFiles from '../files/update-files.js';
import '../files/find-files.js';
import '../files/cache-file.js';
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
vi.mock('../files/cache-file.js');
vi.mock('../cli/cli-params.js', () => ({
  interactive: false,
  ui: false,
  uiPort: 1337,
  disableExplanations: true,
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
  aiStudio: false,
  vision: false,
  imagen: false,
  temperature: 0.7,
  cheap: false,
  taskFile: undefined,
  disableInitialLint: undefined,
  askQuestion: false,
  disableContextOptimization: true,
  geminiBlockNone: undefined,
  contentMask: undefined,
  ignorePatterns: [],
  disableCache: undefined,
  disableAiServiceFallback: undefined,
  disableHistory: true,
  disableSelfReflection: true,
  disableConversationSummary: true,
}));
vi.mock('../files/find-files.js', () => ({
  getSourceFiles: () => [],
  getImageAssetFiles: () => [],
  refreshFiles: () => null,
}));
vi.mock('../cli/cli-options.js', () => ({
  printHelpMessage: vi.fn(),
}));
vi.mock('../ai-service/vertex-ai-imagen.js', () => ({ generateImage: vi.fn() }));
vi.mock('../ai-service/dall-e.js', () => ({ generateImage: vi.fn() }));
vi.mock('./config.js', () => ({
  rootDir: '/mocked/root/dir',
  rcConfig: {
    rootDir: '/mocked/root/dir',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
  },
  importantContext: {},
}));

describe('runCodegen', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cliParams).aiService = undefined;
    vi.mocked(cliParams).dryRun = false;
    vi.mocked(cliParams).helpRequested = false;
    vi.mocked(cliParams).vision = false;
    vi.mocked(cliParams).imagen = undefined;
  });

  it('should run codegen with Vertex AI by default', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';

    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Hello");' } },
    ];
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockFunctionCalls);

    await runCodegen();

    expect(vertexAi.generateContent).toHaveBeenCalled();
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls, expect.anything());
  });

  it('should run codegen with ChatGPT when chatGpt flag is true', async () => {
    vi.mocked(cliParams).aiService = 'chat-gpt';

    const mockFunctionCalls = [{ name: 'createFile', args: { filePath: 'new.js', newContent: 'const x = 5;' } }];
    vi.mocked(chatGpt).generateContent.mockResolvedValueOnce(mockFunctionCalls);

    await runCodegen();

    expect(chatGpt.generateContent).toHaveBeenCalled();
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls, expect.anything());
  });

  it('should run codegen with Anthropic when anthropic flag is true', async () => {
    vi.mocked(cliParams).aiService = 'anthropic';

    const mockFunctionCalls = [{ name: 'deleteFile', args: { filePath: 'obsolete.js' } }];
    vi.mocked(anthropic).generateContent.mockResolvedValueOnce(mockFunctionCalls);

    await runCodegen();

    expect(anthropic.generateContent).toHaveBeenCalled();
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls, expect.anything());
  });

  it('should not update files in dry run mode', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).dryRun = true;

    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Dry run");' } },
    ];
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockFunctionCalls);

    await runCodegen();

    expect(vertexAi.generateContent).toHaveBeenCalled();
    expect(updateFiles.updateFiles).not.toHaveBeenCalled();
  });

  it('should run codegen with Vertex AI Claude when vertexAiClaude flag is true', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai-claude';

    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Hello from Claude");' } },
    ];
    vi.mocked(vertexAiClaude).generateContent.mockResolvedValueOnce(mockFunctionCalls);

    await runCodegen();

    expect(vertexAiClaude.generateContent).toHaveBeenCalled();
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls, expect.anything());
  });

  it('should pass the temperature parameter to the AI service', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).temperature = 0.5;

    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Temperature test");' } },
    ];
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockFunctionCalls);

    await runCodegen();

    expect(vertexAi.generateContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      0.5,
      false,
      expect.anything(),
    );
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls, expect.anything());
  });

  it('should print help message and not run codegen when --help option is provided', async () => {
    vi.mocked(cliParams).helpRequested = true;

    await runCodegen();

    expect(cliOptions.printHelpMessage).toHaveBeenCalled();
    expect(vertexAi.generateContent).not.toHaveBeenCalled();
    expect(chatGpt.generateContent).not.toHaveBeenCalled();
    expect(anthropic.generateContent).not.toHaveBeenCalled();
    expect(vertexAiClaude.generateContent).not.toHaveBeenCalled();
    expect(updateFiles.updateFiles).not.toHaveBeenCalled();
  });

  it('should run codegen with vision when vision flag is true', async () => {
    vi.mocked(cliParams).aiService = 'chat-gpt';
    vi.mocked(cliParams).vision = true;

    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Vision test");' } },
    ];
    vi.mocked(chatGpt).generateContent.mockResolvedValueOnce(mockFunctionCalls);

    await runCodegen();

    expect(chatGpt.generateContent).toHaveBeenCalled();
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls, expect.anything());
    // Check if the generateContent function was called with the correct parameters
    expect(vi.mocked(chatGpt).generateContent.mock.calls[0][0]).toEqual(
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
    vi.mocked(cliParams).imagen = 'vertex-ai';
    vi.mocked(cliParams).aiService = 'vertex-ai';

    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [
            { filePath: '/mocked/root/dir/landscape.png', updateToolName: 'generateImage', prompt: 'Generate image' },
          ],
          contextPaths: [],
          explanation: 'Mock summary with image generation failure',
        },
      },
    ];
    const mockFunctionCalls = [
      {
        name: 'generateImage',
        args: { prompt: 'A beautiful landscape', filePath: '/mocked/root/dir/landscape.png', width: 512, height: 512 },
      },
    ];
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockCodegenSummary);
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockFunctionCalls);
    vi.mocked(vertexAiImagen).generateImage.mockResolvedValueOnce('mocked-image-data');

    await runCodegen();

    expect(vertexAi.generateContent).toHaveBeenCalled();
    expect(vertexAiImagen.generateImage).toHaveBeenCalledWith(
      'A beautiful landscape',
      undefined,
      {
        height: 512,
        width: 512,
      },
      false,
    );
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls, expect.anything());
  });

  it('should use DALL-E when imagen flag is set to dall-e', async () => {
    vi.mocked(cliParams).imagen = 'dall-e';
    vi.mocked(cliParams).aiService = 'chat-gpt';

    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [
            { filePath: '/mocked/root/dir/city.png', updateToolName: 'generateImage', prompt: 'Generate image' },
          ],
          contextPaths: [],
          explanation: 'Mock summary with image generation failure',
        },
      },
    ];
    const mockFunctionCalls = [
      {
        name: 'generateImage',
        args: { prompt: 'A futuristic city', filePath: '/mocked/root/dir/city.png', width: 1024, height: 1024 },
      },
    ];
    vi.mocked(chatGpt).generateContent.mockResolvedValueOnce(mockCodegenSummary);
    vi.mocked(chatGpt).generateContent.mockResolvedValueOnce(mockFunctionCalls);
    vi.mocked(dallE).generateImage.mockResolvedValueOnce('mocked-image-data');

    await runCodegen();

    expect(chatGpt.generateContent).toHaveBeenCalled();
    expect(dallE.generateImage).toHaveBeenCalledWith(
      'A futuristic city',
      undefined,
      { width: 1024, height: 1024 },
      false,
    );
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls, expect.anything());
  });

  it('should throw an error when imagen flag is set but no AI service is specified', async () => {
    vi.mocked(cliParams).imagen = 'vertex-ai';

    await expect(runCodegen()).rejects.toThrow('Please specify which AI service should be used');
  });

  it('should pass the cheap parameter to the AI service when --cheap flag is true', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).cheap = true;

    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Cheap test");' } },
    ];
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockFunctionCalls);

    await runCodegen();

    expect(vertexAi.generateContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
      expect.anything(),
    );
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls, expect.anything());
  });

  it('should pass the cheap parameter to the image generation service when --cheap flag is true', async () => {
    vi.mocked(cliParams).imagen = 'vertex-ai';
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).cheap = true;

    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [
            { filePath: '/mocked/root/dir/landscape.png', updateToolName: 'generateImage', prompt: 'Generate image' },
          ],
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
          filePath: '/mocked/root/dir/landscape.png',
          width: 256,
          height: 256,
          cheap: true,
        },
      },
    ];
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockCodegenSummary);
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockFunctionCalls);
    vi.mocked(vertexAiImagen).generateImage.mockResolvedValueOnce('mocked-cheap-image-data');

    await runCodegen();

    expect(vertexAi.generateContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
      expect.anything(),
    );
    expect(vertexAiImagen.generateImage).toHaveBeenCalledWith(
      'A simple landscape',
      undefined,
      { width: 256, height: 256 },
      true,
    );
    expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockFunctionCalls, expect.anything());
  });
});
