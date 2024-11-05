import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runCodegen } from './codegen.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as chatGpt from '../ai-service/chat-gpt.js';
import * as vertexAiImagen from '../ai-service/vertex-ai-imagen.js';
import * as dallE from '../ai-service/dall-e.js';
import * as updateFiles from '../files/update-files.js';
import * as cliParams from '../cli/cli-params.js';
import '../files/find-files.js';
import '../files/cache-file.js';
import './config.js';

import {
  createMockPlanningResponse,
  createMockCodegenSummary,
  createMockImageGenerationResponse,
  createMockResponseSequence,
} from './codegen.test-utils.js';

// Mock all required modules
vi.mock('../cli/cli-params.js', () => ({
  interactive: false,
  ui: false,
  uiPort: 1337,
  disableExplanations: true,
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
  disableConversationSummary: true,
  aiService: undefined as string | undefined,
  dryRun: false,
}));
vi.mock('../ai-service/vertex-ai.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/chat-gpt.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/vertex-ai-imagen.js', () => ({ generateImage: vi.fn() }));
vi.mock('../ai-service/dall-e.js', () => ({ generateImage: vi.fn() }));
vi.mock('../files/update-files.js');
vi.mock('../files/cache-file.js');
vi.mock('../files/find-files.js', () => ({
  getSourceFiles: () => [],
  getImageAssetFiles: () => [],
  refreshFiles: () => null,
}));
vi.mock('./config.js', () => ({
  rootDir: '/mocked/root/dir',
  rcConfig: {
    rootDir: '/mocked/root/dir',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
  },
  importantContext: {},
}));

describe('Image Generation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Reset CLI parameters to default values
    vi.mocked(cliParams).aiService = undefined;
    vi.mocked(cliParams).dryRun = false;
    vi.mocked(cliParams).helpRequested = false;
    vi.mocked(cliParams).vision = false;
    vi.mocked(cliParams).imagen = undefined;
    vi.mocked(cliParams).cheap = false;
    vi.mocked(cliParams).temperature = 0.7;
    vi.mocked(cliParams).explicitPrompt = 'test';
  });

  describe('Vertex AI Imagen', () => {
    it('should use Vertex AI Imagen when imagen flag is set to vertex-ai', async () => {
      vi.mocked(cliParams).imagen = 'vertex-ai';
      vi.mocked(cliParams).aiService = 'vertex-ai';

      const mockPlanning = createMockPlanningResponse(
        'Test analysis for Vertex AI Imagen',
        'Generate landscape image',
        [{ filePath: '/mocked/root/dir/landscape.png', reason: 'Generate test image' }],
      );

      const mockSummary = createMockCodegenSummary(
        [
          {
            filePath: '/mocked/root/dir/landscape.png',
            updateToolName: 'generateImage',
            prompt: 'Generate image',
          },
        ],
        [],
        'Mock summary with image generation',
      );

      const mockGenerate = createMockImageGenerationResponse(
        'A beautiful landscape',
        '/mocked/root/dir/landscape.png',
        512,
        512,
        'Generate a beautiful landscape image',
      );

      const mockSequence = createMockResponseSequence(mockPlanning, mockSummary, [mockGenerate]);
      mockSequence.forEach((response) => {
        vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(response);
      });

      vi.mocked(vertexAiImagen.generateImage).mockResolvedValueOnce('mocked-image-data');

      await runCodegen();

      expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
      expect(vertexAiImagen.generateImage).toHaveBeenCalledWith(
        'A beautiful landscape',
        undefined,
        {
          height: 512,
          width: 512,
        },
        false,
      );
      expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockGenerate, expect.anything());
    });

    it('should pass the cheap parameter to Vertex AI Imagen when --cheap flag is true', async () => {
      vi.mocked(cliParams).imagen = 'vertex-ai';
      vi.mocked(cliParams).aiService = 'vertex-ai';
      vi.mocked(cliParams).cheap = true;

      const mockPlanning = createMockPlanningResponse(
        'Test analysis for cheap Vertex AI Imagen',
        'Generate small landscape image',
        [{ filePath: '/mocked/root/dir/landscape.png', reason: 'Generate small test image' }],
      );

      const mockSummary = createMockCodegenSummary(
        [
          {
            filePath: '/mocked/root/dir/landscape.png',
            updateToolName: 'generateImage',
            prompt: 'Generate small image',
          },
        ],
        [],
        'Mock summary with cheap image generation',
      );

      const mockGenerate = createMockImageGenerationResponse(
        'A simple landscape',
        '/mocked/root/dir/landscape.png',
        256,
        256,
        'Generate a simple landscape image',
      );

      const mockSequence = createMockResponseSequence(mockPlanning, mockSummary, [mockGenerate]);
      mockSequence.forEach((response) => {
        vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(response);
      });

      vi.mocked(vertexAiImagen.generateImage).mockResolvedValueOnce('mocked-cheap-image-data');

      await runCodegen();

      expect(vertexAiImagen.generateImage).toHaveBeenCalledWith(
        'A simple landscape',
        undefined,
        {
          height: 256,
          width: 256,
        },
        false,
      );
    });
  });

  describe('DALL-E', () => {
    it('should use DALL-E when imagen flag is set to dall-e', async () => {
      vi.mocked(cliParams).imagen = 'dall-e';
      vi.mocked(cliParams).aiService = 'chat-gpt';

      const mockPlanning = createMockPlanningResponse('Test analysis for DALL-E', 'Generate city image', [
        { filePath: '/mocked/root/dir/city.png', reason: 'Generate test image' },
      ]);

      const mockSummary = createMockCodegenSummary(
        [
          {
            filePath: '/mocked/root/dir/city.png',
            updateToolName: 'generateImage',
            prompt: 'Generate image',
          },
        ],
        [],
        'Mock summary with image generation',
      );

      const mockGenerate = createMockImageGenerationResponse(
        'A futuristic city',
        '/mocked/root/dir/city.png',
        1024,
        1024,
        'Generate a futuristic city image',
      );

      const mockSequence = createMockResponseSequence(mockPlanning, mockSummary, [mockGenerate]);
      mockSequence.forEach((response) => {
        vi.mocked(chatGpt.generateContent).mockResolvedValueOnce(response);
      });

      vi.mocked(dallE.generateImage).mockResolvedValueOnce('mocked-image-data');

      await runCodegen();

      expect(chatGpt.generateContent).toHaveBeenCalledTimes(3);
      expect(dallE.generateImage).toHaveBeenCalledWith(
        'A futuristic city',
        undefined,
        {
          width: 1024,
          height: 1024,
        },
        false,
      );
      expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockGenerate, expect.anything());
    });
  });

  describe('Error Handling', () => {
    it('should throw an error when imagen flag is set but no AI service is specified', async () => {
      vi.mocked(cliParams).imagen = 'vertex-ai';
      vi.mocked(cliParams).aiService = undefined;

      await expect(runCodegen()).rejects.toThrow('Please specify which AI service should be used');
    });

    it('should handle image generation errors gracefully', async () => {
      vi.mocked(cliParams).imagen = 'vertex-ai';
      vi.mocked(cliParams).aiService = 'vertex-ai';

      const mockPlanning = createMockPlanningResponse();
      const mockSummary = createMockCodegenSummary(
        [
          {
            filePath: '/mocked/root/dir/error.png',
            updateToolName: 'generateImage',
            prompt: 'Generate error image',
          },
        ],
        [],
        'Mock summary with error',
      );

      const mockGenerate = createMockImageGenerationResponse('Error image', '/mocked/root/dir/error.png');

      const mockSequence = createMockResponseSequence(mockPlanning, mockSummary, [mockGenerate]);
      mockSequence.forEach((response) => {
        vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(response);
      });

      vi.mocked(vertexAiImagen.generateImage).mockRejectedValueOnce(new Error('Generation failed'));

      await runCodegen();

      expect(vertexAiImagen.generateImage).toHaveBeenCalled();
      // The error should be caught and handled without breaking the test
    });
  });
});
