import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promptService } from './prompt-service.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as vertexAiClaude from '../ai-service/vertex-ai-claude.js';
import * as openai from '../ai-service/openai.js';
import * as anthropic from '../ai-service/anthropic.js';
import * as dalleService from '../ai-service/dall-e.js';
import * as vertexAiImagen from '../ai-service/vertex-ai-imagen.js';
import * as cliParams from '../cli/cli-params.js';
import { getCodeGenPrompt } from './prompt-codegen.js';
import { ImagenType } from '../main/codegen-types.js';
import { AiServiceType } from '../ai-service/service-configurations-types.js';
import { GenerateImageFunction } from '../ai-service/common-types.js';
import { GenerateContentFunction } from '../ai-service/common-types.js';
import { mockData, mockResponses, testConfigs } from './prompt-service.test-utils.js';

// Mock all external dependencies
vi.mock('../ai-service/vertex-ai-claude.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/vertex-ai.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/openai.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/anthropic.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/dall-e.js', () => ({ generateImage: vi.fn() }));
vi.mock('../ai-service/vertex-ai-imagen.js', () => ({ generateImage: vi.fn() }));
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

describe('promptService - AI Services', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cliParams).dryRun = false;
    vi.mocked(cliParams).vision = false;
    vi.mocked(cliParams).imagen = undefined;
    vi.mocked(cliParams).disableContextOptimization = true;
    vi.mocked(cliParams).explicitPrompt = 'testx';
  });

  it('should process requests with Vertex AI', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';

    // Setup mocks for the entire flow
    vi.mocked(vertexAi.generateContent)
      // First mock for codegenPlanning
      .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.test))
      // Second mock for codegenSummary
      .mockResolvedValueOnce(mockResponses.mockCodegenSummary(mockData.paths.test))
      // Third mock for the actual update
      .mockResolvedValueOnce(mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Hello");'));

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt(testConfigs.baseConfig),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    expect(result).toEqual(mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Hello");'));
  });

  it('should process requests with OpenAI', async () => {
    vi.mocked(cliParams).aiService = 'openai';

    // Setup mocks for the entire flow
    vi.mocked(openai.generateContent)
      // First mock for codegenPlanning
      .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.test))
      // Second mock for codegenSummary
      .mockResolvedValueOnce(mockResponses.mockCodegenSummary(mockData.paths.test, 'createFile'))
      // Third mock for the actual create
      .mockResolvedValueOnce(mockResponses.mockCreateFile(mockData.paths.test, 'const x = 5;'));

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        ...testConfigs.baseConfig,
        aiService: 'openai',
      }),
    );

    expect(openai.generateContent).toHaveBeenCalledTimes(3);
    expect(result).toEqual(mockResponses.mockCreateFile(mockData.paths.test, 'const x = 5;'));
  });

  it('should process requests with Anthropic', async () => {
    vi.mocked(cliParams).aiService = 'anthropic';

    // Setup mocks for the entire flow
    vi.mocked(anthropic.generateContent)
      // First mock for codegenPlanning
      .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.test))
      // Second mock for codegenSummary
      .mockResolvedValueOnce(mockResponses.mockCodegenSummary(mockData.paths.test, 'deleteFile'))
      // Third mock for the actual delete
      .mockResolvedValueOnce(mockResponses.mockDeleteFile(mockData.paths.test));

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        ...testConfigs.baseConfig,
        aiService: 'anthropic',
      }),
    );

    expect(anthropic.generateContent).toHaveBeenCalledTimes(3);
    expect(result).toEqual(mockResponses.mockDeleteFile(mockData.paths.test));
  });

  it('should not update files in dry run mode', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).dryRun = true;

    // Setup mocks for the entire flow
    vi.mocked(vertexAi.generateContent)
      // First mock for codegenPlanning
      .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.test))
      // Second mock for codegenSummary
      .mockResolvedValueOnce(mockResponses.mockCodegenSummary(mockData.paths.test))
      // Third mock for the actual update
      .mockResolvedValueOnce(mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Dry run");'));

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        ...testConfigs.baseConfig,
        dryRun: true,
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    expect(result).toEqual(mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Dry run");'));
  });

  it('should handle unexpected response without codegen summary', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    const mockUnexpectedResponse = mockResponses.mockUpdateFile(
      mockData.paths.test,
      'console.log("Unexpected response");',
    );

    // Mock only the codegenPlanning response, then return unexpected response
    vi.mocked(vertexAi.generateContent)
      .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.test))
      .mockResolvedValueOnce(mockUnexpectedResponse);

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt(testConfigs.baseConfig),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    expect(result).toEqual([]);
  });
});
