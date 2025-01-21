import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promptService } from './prompt-service.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as vertexAiClaude from '../ai-service/vertex-ai-claude.js';
import * as openai from '../ai-service/openai.js';
import * as anthropic from '../ai-service/anthropic.js';
import * as cliParams from '../cli/cli-params.js';
import fs from 'fs';
import mime from 'mime-types';
import { getImageAssets } from '../files/read-files.js';
import * as dalleService from '../ai-service/dall-e.js';
import * as vertexAiImagen from '../ai-service/vertex-ai-imagen.js';
import { getCodeGenPrompt } from './prompt-codegen.js';
import { ImagenType } from '../main/codegen-types.js';
import { AiServiceType } from '../ai-service/service-configurations-types.js';
import { GenerateImageFunction } from '../ai-service/common-types.js';
import { GenerateContentFunction } from '../ai-service/common-types.js';
import { ModelType } from '../ai-service/common-types.js';
import { mockData, mockResponses, testConfigs } from './prompt-service.test-utils.js';

// Mock all external dependencies
vi.mock('../ai-service/vertex-ai-claude.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/vertex-ai.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/openai.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/anthropic.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/dall-e.js', () => ({ generateImage: vi.fn() }));
vi.mock('../ai-service/vertex-ai-imagen.js', () => ({ generateImage: vi.fn() }));
vi.mock('fs');
vi.mock('mime-types');
vi.mock('../cli/cli-params.js', () => ({
  disableExplanations: true,
  explicitPrompt: false,
  allowFileCreate: false,
  allowFileDelete: false,
  allowDirectoryCreate: false,
  allowFileMove: false,
  verbosePrompt: false,
  disableContextOptimization: true,
  vision: false,
  imagen: false,
  temperature: 0.7,
  cheap: false,
  askQuestion: false,
}));
vi.mock('../files/cache-file.js');
vi.mock('../files/find-files.js', () => ({
  getSourceFiles: () => [],
  getImageAssetFiles: () => [],
}));
vi.mock('../files/read-files.js', () => ({
  getSourceCode: () => ({}),
  getImageAssets: vi.fn(() => ({})),
}));
vi.mock('../main/config.js', () => ({
  rootDir: '/mocked/root/dir',
  rcConfig: {
    rootDir: '/mocked/root/dir',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
  },
  importantContext: {},
}));

const GENERATE_CONTENT_FNS: Record<AiServiceType, GenerateContentFunction> = {
  'vertex-ai-claude': vertexAiClaude.generateContent,
  'vertex-ai': vertexAi.generateContent,
  'ai-studio': vertexAi.generateContent,
  anthropic: anthropic.generateContent,
  openai: openai.generateContent,
} as const;

const GENERATE_IMAGE_FNS: Record<ImagenType, GenerateImageFunction> = {
  'dall-e': dalleService.generateImage,
  'vertex-ai': vertexAiImagen.generateImage,
} as const;

describe('promptService - Image Handling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cliParams).dryRun = false;
    vi.mocked(cliParams).vision = false;
    vi.mocked(cliParams).imagen = undefined;
    vi.mocked(cliParams).disableContextOptimization = true;
    vi.mocked(cliParams).explicitPrompt = 'testx';
  });

  describe('Vision Features', () => {
    it('should include image assets when vision flag is true', async () => {
      vi.mocked(cliParams).aiService = 'openai';
      vi.mocked(cliParams).vision = true;

      // Setup mocks
      vi.mocked(getImageAssets).mockReturnValue(mockData.imageAssets);
      vi.mocked(openai.generateContent)
        // First mock for codegenPlanning
        .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.test))
        // Second mock for codegenSummary
        .mockResolvedValueOnce(mockResponses.mockCodegenSummary(mockData.paths.test))
        // Third mock for the actual update
        .mockResolvedValueOnce(mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Vision test");'));

      await promptService(GENERATE_CONTENT_FNS, GENERATE_IMAGE_FNS, getCodeGenPrompt(testConfigs.visionConfig));

      expect(openai.generateContent).toHaveBeenCalledTimes(3);
      const calls = vi.mocked(openai.generateContent).mock.calls[0];
      expect(calls[0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'user',
            functionResponses: expect.arrayContaining([
              { name: 'getImageAssets', content: JSON.stringify(mockData.imageAssets) },
            ]),
          }),
        ]),
      );
    });

    it('should include image data in the prompt when processing files with vision', async () => {
      vi.mocked(cliParams).aiService = 'openai';
      vi.mocked(cliParams).vision = true;

      const mockCodegenSummary = [
        {
          name: 'codegenSummary',
          args: {
            fileUpdates: [
              {
                filePath: mockData.paths.test,
                updateToolName: 'updateFile',
                contextImageAssets: [`${mockData.paths.root}/image1.png`, `${mockData.paths.root}/image2.jpg`],
                prompt: 'Generate file update',
              },
            ],
            contextPaths: [],
            explanation: 'Mock summary',
          },
        },
      ];

      // Setup mocks
      vi.mocked(openai.generateContent)
        // First mock for codegenPlanning
        .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.test))
        // Second mock for codegenSummary
        .mockResolvedValueOnce(mockCodegenSummary)
        // Third mock for the actual update
        .mockResolvedValueOnce(
          mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Updated with vision");'),
        );

      vi.mocked(fs.readFileSync).mockImplementation((path) => `mock-base64-data-for-${path}`);
      vi.mocked(mime.lookup).mockImplementation((path) => (path.endsWith('.png') ? 'image/png' : 'image/jpeg'));

      await promptService(GENERATE_CONTENT_FNS, GENERATE_IMAGE_FNS, getCodeGenPrompt(testConfigs.visionConfig));

      expect(openai.generateContent).toHaveBeenCalledTimes(3);
      const secondCall = vi.mocked(openai.generateContent).mock.calls[2];
      expect(secondCall[0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'user',
            text: expect.stringContaining('Generate file update'),
            images: [
              {
                path: `${mockData.paths.root}/image1.png`,
                base64url: `mock-base64-data-for-${mockData.paths.root}/image1.png`,
                mediaType: 'image/png',
              },
              {
                path: `${mockData.paths.root}/image2.jpg`,
                base64url: `mock-base64-data-for-${mockData.paths.root}/image2.jpg`,
                mediaType: 'image/jpeg',
              },
            ],
          }),
        ]),
      );
    });

    it('should not include image assets when vision flag is false', async () => {
      vi.mocked(cliParams).aiService = 'openai';
      vi.mocked(cliParams).vision = false;

      // Setup mocks
      vi.mocked(openai.generateContent)
        // First mock for codegenPlanning
        .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.test))
        // Second mock for codegenSummary
        .mockResolvedValueOnce(mockResponses.mockCodegenSummary(mockData.paths.test))
        // Third mock for the actual update
        .mockResolvedValueOnce(mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("No vision test");'));

      await promptService(
        GENERATE_CONTENT_FNS,
        GENERATE_IMAGE_FNS,
        getCodeGenPrompt({ ...testConfigs.baseConfig, aiService: 'openai' }),
      );

      expect(openai.generateContent).toHaveBeenCalledTimes(3);
      const calls = vi.mocked(openai.generateContent).mock.calls[0];
      expect(calls[0]).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'user',
            text: expect.stringContaining('I should also provide you with a summary of application image assets'),
          }),
        ]),
      );
    });
  });

  describe('Image Generation', () => {
    it('should handle successful image generation', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';
      vi.mocked(cliParams).imagen = 'dall-e';

      // Setup mocks
      vi.mocked(vertexAi.generateContent)
        // First mock for codegenPlanning
        .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.image))
        // Second mock for codegenSummary
        .mockResolvedValueOnce(mockResponses.mockCodegenSummary(mockData.paths.image, 'generateImage'))
        // Third mock for the actual image generation
        .mockResolvedValueOnce(mockResponses.mockGenerateImage(mockData.paths.image));

      vi.mocked(dalleService.generateImage).mockResolvedValue(mockData.imageGenerationUrl);

      const result = await promptService(
        GENERATE_CONTENT_FNS,
        GENERATE_IMAGE_FNS,
        getCodeGenPrompt(testConfigs.imagenConfig),
      );

      expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
      expect(dalleService.generateImage).toHaveBeenCalledWith(
        'A test image',
        undefined,
        { width: 256, height: 256 },
        ModelType.DEFAULT,
      );
      expect(result).toEqual(
        expect.arrayContaining(mockResponses.mockDownloadFile(mockData.paths.image, mockData.imageGenerationUrl)),
      );
    });

    it('should handle image generation failure', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';
      vi.mocked(cliParams).imagen = 'dall-e';

      // Setup mocks
      vi.mocked(vertexAi.generateContent)
        // First mock for codegenPlanning
        .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.image))
        // Second mock for codegenSummary
        .mockResolvedValueOnce(mockResponses.mockCodegenSummary(mockData.paths.image, 'generateImage'))
        // Third mock for the actual image generation
        .mockResolvedValueOnce(mockResponses.mockGenerateImage(mockData.paths.image));

      vi.mocked(dalleService.generateImage).mockRejectedValue(new Error('Image generation failed'));

      const result = await promptService(
        GENERATE_CONTENT_FNS,
        GENERATE_IMAGE_FNS,
        getCodeGenPrompt(testConfigs.imagenConfig),
      );

      expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
      expect(dalleService.generateImage).toHaveBeenCalledWith(
        'A test image',
        undefined,
        { width: 256, height: 256 },
        ModelType.DEFAULT,
      );
      expect(result).toEqual(
        expect.arrayContaining(mockResponses.mockExplanation('Failed to generate image: Image generation failed')),
      );
    });
  });
});
