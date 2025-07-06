import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promptService } from './prompt-service.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as vertexAiClaude from '../ai-service/vertex-ai-claude.js';
import * as openai from '../ai-service/openai.js';
import * as anthropic from '../ai-service/anthropic.js';
import * as localLlm from '../ai-service/local-llm.js';
import * as cliParams from '../cli/cli-params.js';
import * as dalleService from '../ai-service/dall-e.js';
import * as vertexAiImagen from '../ai-service/vertex-ai-imagen.js';
import { getCodeGenPrompt } from './prompt-codegen.js';
import { ImagenType } from '../main/codegen-types.js';
import { AiServiceType } from '../ai-service/service-configurations-types.js';
import { GenerateContentFunction, GenerateImageFunction } from '../ai-service/common-types.js';
import { mockData, mockResponses, testConfigs } from './prompt-service.test-utils.js';
import { PROMPT_CODEGEN_SUMMARY } from './steps/step-generate-codegen-summary-prompt.js';

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
  disableContextOptimization: false,
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
  refreshFiles: () => null,
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

describe('promptService - Context Optimization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cliParams).dryRun = false;
    vi.mocked(cliParams).vision = false;
    vi.mocked(cliParams).imagen = undefined;
    vi.mocked(cliParams).explicitPrompt = 'testx';
  });

  it('should handle context optimization when enabled', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).disableContextOptimization = false;

    const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.test);
    const mockCodegenSummaryResult = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [
            { id: '1', filePath: mockData.paths.test, updateToolName: 'updateFile', prompt: 'Generate file' },
          ],
          contextPaths: [mockData.paths.context1, mockData.paths.context2],
          explanation: 'Mock summary with context',
        },
      },
    ];
    const updateResponse = mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Updated with context");');

    // Setup mocks for the entire flow
    vi.mocked(vertexAi.generateContent)
      .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(mockCodegenSummaryResult.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(updateResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })));

    await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        ...testConfigs.baseConfig,
        disableContextOptimization: false,
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    // Check the first call (planning) includes getSourceCode response
    const firstCallArgs = vi.mocked(vertexAi.generateContent).mock.calls[0];
    expect(firstCallArgs[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'user',
          functionResponses: expect.arrayContaining([
            expect.objectContaining({ name: 'getSourceCode', content: expect.any(String) }),
          ]),
        }),
      ]),
    );
    // Ensure the second call (summary generation) uses the planning result
    const secondCall = vi.mocked(vertexAi.generateContent).mock.calls[1];
    expect(secondCall[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'assistant', functionCalls: planningResponse }),
        expect.objectContaining({ type: 'user', functionResponses: expect.anything() }), // Response to planning call
        expect.objectContaining({ type: 'user', text: expect.stringContaining(PROMPT_CODEGEN_SUMMARY) }), // Summary prompt
      ]),
    );
  });

  it('should not include context paths when context optimization is disabled', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).disableContextOptimization = true;

    const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.test);
    const mockCodegenSummaryResult = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [
            { id: '1', filePath: mockData.paths.test, updateToolName: 'updateFile', prompt: 'Generate file' },
          ],
          contextPaths: [mockData.paths.context1, mockData.paths.context2], // Still provided by mock, but should be ignored
          explanation: 'Mock summary without context optimization',
        },
      },
    ];
    const updateResponse = mockResponses.mockUpdateFile(
      mockData.paths.test,
      'console.log("Updated without context optimization");',
    );

    // Setup mocks for the entire flow
    vi.mocked(vertexAi.generateContent)
      .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(mockCodegenSummaryResult.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(updateResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })));

    await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        ...testConfigs.baseConfig,
        disableContextOptimization: true,
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    // Check that the getSourceCode call in the initial prompt doesn't include context1.js or context2.js
    const firstCall = vi.mocked(vertexAi.generateContent).mock.calls[0];
    const sourceCodeResponse = firstCall[0].find(
      (item) => item.type === 'user' && item.functionResponses?.[0]?.name === 'getSourceCode',
    );
    expect(sourceCodeResponse?.functionResponses?.[0].content).not.toContain('context1.js');
    expect(sourceCodeResponse?.functionResponses?.[0].content).not.toContain('context2.js');
  });

  it('should handle context optimization with multiple file updates', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).disableContextOptimization = false;

    const planningResponse = mockResponses.mockPlanningResponse(`${mockData.paths.root}/test1.js`);
    const mockCodegenSummaryResult = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [
            {
              id: '1',
              filePath: `${mockData.paths.root}/test1.js`,
              updateToolName: 'updateFile',
              prompt: 'Generate file 1',
            },
            {
              id: '2',
              filePath: `${mockData.paths.root}/test2.js`,
              updateToolName: 'updateFile',
              prompt: 'Generate file 2',
            },
          ],
          contextPaths: [mockData.paths.context1, mockData.paths.context2],
          explanation: 'Mock summary with multiple files',
        },
      },
    ];
    const update1Response = mockResponses.mockUpdateFile(`${mockData.paths.root}/test1.js`, 'console.log("File 1");');
    const update2Response = mockResponses.mockUpdateFile(`${mockData.paths.root}/test2.js`, 'console.log("File 2");');

    // Setup mocks for the entire flow
    vi.mocked(vertexAi.generateContent)
      .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(mockCodegenSummaryResult.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(update1Response.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(update2Response.map((fc) => ({ type: 'functionCall', functionCall: fc })));

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        ...testConfigs.baseConfig,
        disableContextOptimization: false,
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(4); // Planning, Summary, Update1, Update2
    expect(result).toEqual([...update1Response, ...update2Response]);
  });

  it('should handle empty context paths array', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).disableContextOptimization = false;

    const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.test);
    const mockCodegenSummaryResult = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [
            { id: '1', filePath: mockData.paths.test, updateToolName: 'updateFile', prompt: 'Generate file' },
          ],
          contextPaths: [], // Empty context paths
          explanation: 'Mock summary with no context',
        },
      },
    ];
    const updateResponse = mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("No context needed");');

    // Setup mocks for the entire flow
    vi.mocked(vertexAi.generateContent)
      .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(mockCodegenSummaryResult.map((fc) => ({ type: 'functionCall', functionCall: fc })))
      .mockResolvedValueOnce(updateResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })));

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        ...testConfigs.baseConfig,
        disableContextOptimization: false,
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    expect(result).toEqual(updateResponse);
    // Check that no extra context files were requested beyond the initial source code
    const firstCall = vi.mocked(vertexAi.generateContent).mock.calls[0];
    const sourceCodeResponse = firstCall[0].find(
      (item) => item.type === 'user' && item.functionResponses?.[0]?.name === 'getSourceCode',
    );
    const sourceCode = JSON.parse(sourceCodeResponse?.functionResponses?.[0].content ?? '{}');
    expect(Object.keys(sourceCode)).not.toContain(mockData.paths.context1);
  });
});
