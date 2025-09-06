import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promptService } from './prompt-service.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as openai from '../ai-service/openai.js';
import * as anthropic from '../ai-service/anthropic.js';
import * as localLlm from '../ai-service/local-llm.js';
import * as cliParams from '../cli/cli-params.js';
import fs from 'fs';
import mime from 'mime-types';
import { getImageAssets } from '../files/read-files.js';
import * as dalleService from '../ai-service/dall-e.js';
import * as vertexAiImagen from '../ai-service/vertex-ai-imagen.js';
import { getCodeGenPrompt } from './prompt-codegen.js';
import { ImagenType } from '../main/codegen-types.js';
import { AiServiceType } from '../ai-service/service-configurations-types.js';
import { GenerateContentFunction, GenerateImageFunction } from '../ai-service/common-types.js';
import { ModelType } from '../ai-service/common-types.js';
import { mockData, mockResponses, testConfigs } from './prompt-service.test-utils.js';

// Mock all external dependencies
vi.mock('../ai-service/vertex-ai.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/openai.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/anthropic.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/local-llm.js', () => ({ generateContent: vi.fn() }));
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
  'vertex-ai': vertexAi.generateContent,
  'ai-studio': vertexAi.generateContent,
  anthropic: anthropic.generateContent,
  openai: openai.generateContent,
  'local-llm': localLlm.generateContent,
  'github-models': openai.generateContent, // Reuse OpenAI implementation for testing
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

      const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.test);
      const summaryResponse = mockResponses.mockCodegenSummary(mockData.paths.test);
      const updateResponse = mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Vision test");');

      // Setup mocks
      vi.mocked(getImageAssets).mockReturnValue(mockData.imageAssets);
      vi.mocked(openai.generateContent)
        .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(summaryResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(updateResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })));

      await promptService(GENERATE_CONTENT_FNS, GENERATE_IMAGE_FNS, getCodeGenPrompt(testConfigs.visionConfig));

      expect(openai.generateContent).toHaveBeenCalledTimes(3);
      const calls = vi.mocked(openai.generateContent).mock.calls[0];
      // Check the first call (planning) includes getImageAssets response
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

      const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.test);
      const mockCodegenSummaryResult = [
        {
          name: 'codegenSummary',
          args: {
            fileUpdates: [
              {
                id: '1',
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
      const updateResponse = mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Updated with vision");');

      // Setup mocks
      vi.mocked(openai.generateContent)
        .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(mockCodegenSummaryResult.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(updateResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })));

      vi.mocked(fs.readFileSync).mockImplementation((path) => `mock-base64-data-for-${path}`);
      vi.mocked(mime.lookup).mockImplementation((path) => (path.endsWith('.png') ? 'image/png' : 'image/jpeg'));

      await promptService(GENERATE_CONTENT_FNS, GENERATE_IMAGE_FNS, getCodeGenPrompt(testConfigs.visionConfig));

      expect(openai.generateContent).toHaveBeenCalledTimes(3);
      // Check the third call (file update) includes image data
      const thirdCall = vi.mocked(openai.generateContent).mock.calls[2];
      expect(thirdCall[0]).toEqual(
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

      const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.test);
      const summaryResponse = mockResponses.mockCodegenSummary(mockData.paths.test);
      const updateResponse = mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("No vision test");');

      // Setup mocks
      vi.mocked(openai.generateContent)
        .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(summaryResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(updateResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })));

      await promptService(
        GENERATE_CONTENT_FNS,
        GENERATE_IMAGE_FNS,
        getCodeGenPrompt({ ...testConfigs.baseConfig, aiService: 'openai' }),
      );

      expect(openai.generateContent).toHaveBeenCalledTimes(3);
      // Check the first call doesn't mention image assets
      const firstCall = vi.mocked(openai.generateContent).mock.calls[0];
      expect(firstCall[0]).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'user',
            text: expect.stringContaining('I should also provide you with a summary of application image assets'),
          }),
        ]),
      );
      // Check the first call doesn't include getImageAssets function response
      expect(firstCall[0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'user',
            functionResponses: expect.not.arrayContaining([expect.objectContaining({ name: 'getImageAssets' })]),
          }),
        ]),
      );
    });
  });

  describe('Image Generation', () => {
    it('should handle successful image generation', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';
      vi.mocked(cliParams).imagen = 'dall-e'; // Using DALL-E via imagen flag

      const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.image);
      const summaryResponse = mockResponses.mockCodegenSummary(mockData.paths.image, 'generateImage');
      const generateImageResponse = mockResponses.mockGenerateImage(mockData.paths.image);
      const downloadFileResponse = mockResponses.mockDownloadFile(mockData.paths.image, mockData.imageGenerationUrl);

      // Setup mocks
      vi.mocked(vertexAi.generateContent) // Main AI service is Vertex AI
        .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(summaryResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(generateImageResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })));

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
      // The result should contain both the generateImage and downloadFile calls
      expect(result).toEqual([...generateImageResponse, ...downloadFileResponse]);
    });

    it('should handle image generation failure', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';
      vi.mocked(cliParams).imagen = 'dall-e';

      const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.image);
      const summaryResponse = mockResponses.mockCodegenSummary(mockData.paths.image, 'generateImage');
      const generateImageResponse = mockResponses.mockGenerateImage(mockData.paths.image);
      const explanationResponse = mockResponses.mockExplanation('Failed to generate image: Image generation failed');

      // Setup mocks
      vi.mocked(vertexAi.generateContent)
        .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(summaryResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(generateImageResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })));

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
      // The result should contain the generateImage call and the explanation about the failure
      expect(result).toEqual([...generateImageResponse, ...explanationResponse]);
    });
  });
});
