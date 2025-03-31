import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promptService } from './prompt-service.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as vertexAiClaude from '../ai-service/vertex-ai-claude.js';
import * as openai from '../ai-service/openai.js';
import * as anthropic from '../ai-service/anthropic.js';
import * as localLlm from '../ai-service/local-llm.js';
import * as dalleService from '../ai-service/dall-e.js';
import * as vertexAiImagen from '../ai-service/vertex-ai-imagen.js';
import * as cliParams from '../cli/cli-params.js';
import { getCodeGenPrompt } from './prompt-codegen.js';
import { ImagenType } from '../main/codegen-types.js';
import { AiServiceType } from '../ai-service/service-configurations-types.js';
import { GenerateContentFunction, GenerateImageFunction } from '../ai-service/common-types.js';
import { mockData, mockResponses, testConfigs } from './prompt-service.test-utils.js';

// Mock all external dependencies
vi.mock('../ai-service/vertex-ai-claude.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/vertex-ai.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/openai.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/anthropic.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/local-llm.js', () => ({ generateContent: vi.fn() }));
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
  'local-llm': localLlm.generateContent,
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

    const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.test);
    const summaryResponse = mockResponses.mockCodegenSummary(mockData.paths.test);
    const updateResponse = mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Hello");');

    // Setup mocks for the entire flow
    vi.mocked(vertexAi.generateContent)
      .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(summaryResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(updateResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })));

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt(testConfigs.baseConfig),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    expect(result).toEqual(updateResponse);
  });

  it('should process requests with OpenAI', async () => {
    vi.mocked(cliParams).aiService = 'openai';

    const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.test);
    const summaryResponse = mockResponses.mockCodegenSummary(mockData.paths.test, 'createFile');
    const createResponse = mockResponses.mockCreateFile(mockData.paths.test, 'const x = 5;');

    // Setup mocks for the entire flow
    vi.mocked(openai.generateContent)
      .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(summaryResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(createResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })));

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        ...testConfigs.baseConfig,
        aiService: 'openai',
      }),
    );

    expect(openai.generateContent).toHaveBeenCalledTimes(3);
    expect(result).toEqual(createResponse);
  });

  it('should process requests with Anthropic', async () => {
    vi.mocked(cliParams).aiService = 'anthropic';

    const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.test);
    const summaryResponse = mockResponses.mockCodegenSummary(mockData.paths.test, 'deleteFile');
    const deleteResponse = mockResponses.mockDeleteFile(mockData.paths.test);

    // Setup mocks for the entire flow
    vi.mocked(anthropic.generateContent)
      .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(summaryResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(deleteResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })));

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        ...testConfigs.baseConfig,
        aiService: 'anthropic',
      }),
    );

    expect(anthropic.generateContent).toHaveBeenCalledTimes(3);
    expect(result).toEqual(deleteResponse);
  });

  it('should not update files in dry run mode', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).dryRun = true;

    const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.test);
    const summaryResponse = mockResponses.mockCodegenSummary(mockData.paths.test);
    const updateResponse = mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Dry run");');

    // Setup mocks for the entire flow
    vi.mocked(vertexAi.generateContent)
      .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(summaryResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(updateResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })));

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        ...testConfigs.baseConfig,
        dryRun: true,
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    // In dry run mode, the service still returns the planned updates, but they are not applied
    expect(result).toEqual(updateResponse);
  });

  it('should handle unexpected response without codegen summary', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    const mockUnexpectedResponse = mockResponses.mockUpdateFile(
      mockData.paths.test,
      'console.log("Unexpected response");',
    );
    const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.test);

    // Mock only the codegenPlanning response, then return unexpected response
    vi.mocked(vertexAi.generateContent)
      .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      // Mock the second call (expected summary) to return something unexpected
      .mockResolvedValueOnce(mockUnexpectedResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })));

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt(testConfigs.baseConfig),
    );

    // generateContentFn will be called twice: planning and summary attempt
    // The third call (file update) won't happen because the summary was invalid
    expect(vertexAi.generateContent).toHaveBeenCalledTimes(2);
    expect(result).toEqual([]); // Expect empty result as summary failed
  });
});
