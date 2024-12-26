import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promptService } from './prompt-service.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as vertexAiClaude from '../ai-service/vertex-ai-claude.js';
import * as openai from '../ai-service/openai.js';
import * as anthropic from '../ai-service/anthropic.js';
import * as cliParams from '../cli/cli-params.js';
import * as dalleService from '../ai-service/dall-e.js';
import * as vertexAiImagen from '../ai-service/vertex-ai-imagen.js';
import { getCodeGenPrompt } from './prompt-codegen.js';
import { AiServiceType, ImagenType } from '../main/codegen-types.js';
import { GenerateContentFunction, GenerateImageFunction } from '../ai-service/common.js';
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

    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [{ filePath: mockData.paths.test, updateToolName: 'updateFile', prompt: 'Generate file' }],
          contextPaths: [mockData.paths.context1, mockData.paths.context2],
          explanation: 'Mock summary with context',
        },
      },
    ];

    // Setup mocks for the entire flow
    vi.mocked(vertexAi.generateContent)
      // First mock for codegenPlanning
      .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.test))
      // Second mock for codegenSummary
      .mockResolvedValueOnce(mockCodegenSummary)
      // Third mock for the actual update
      .mockResolvedValueOnce(mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Updated with context");'));

    await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        ...testConfigs.baseConfig,
        disableContextOptimization: false,
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    const firstCall = vi.mocked(vertexAi.generateContent).mock.calls[0];
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

  it('should not include context paths when context optimization is disabled', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).disableContextOptimization = true;

    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [{ filePath: mockData.paths.test, updateToolName: 'updateFile', prompt: 'Generate file' }],
          contextPaths: [mockData.paths.context1, mockData.paths.context2],
          explanation: 'Mock summary without context optimization',
        },
      },
    ];

    // Setup mocks for the entire flow
    vi.mocked(vertexAi.generateContent)
      // First mock for codegenPlanning
      .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.test))
      // Second mock for codegenSummary
      .mockResolvedValueOnce(mockCodegenSummary)
      // Third mock for the actual update
      .mockResolvedValueOnce(
        mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Updated without context optimization");'),
      );

    await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        ...testConfigs.baseConfig,
        disableContextOptimization: true,
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    const firstCall = vi.mocked(vertexAi.generateContent).mock.calls[0];
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

  it('should handle context optimization with multiple file updates', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).disableContextOptimization = false;

    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [
            { filePath: `${mockData.paths.root}/test1.js`, updateToolName: 'updateFile', prompt: 'Generate file 1' },
            { filePath: `${mockData.paths.root}/test2.js`, updateToolName: 'updateFile', prompt: 'Generate file 2' },
          ],
          contextPaths: [mockData.paths.context1, mockData.paths.context2],
          explanation: 'Mock summary with multiple files',
        },
      },
    ];

    // Setup mocks for the entire flow
    vi.mocked(vertexAi.generateContent)
      // First mock for codegenPlanning
      .mockResolvedValueOnce(mockResponses.mockPlanningResponse(`${mockData.paths.root}/test1.js`))
      // Second mock for codegenSummary
      .mockResolvedValueOnce(mockCodegenSummary)
      // Third and fourth mocks for the actual updates
      .mockResolvedValueOnce(mockResponses.mockUpdateFile(`${mockData.paths.root}/test1.js`, 'console.log("File 1");'))
      .mockResolvedValueOnce(mockResponses.mockUpdateFile(`${mockData.paths.root}/test2.js`, 'console.log("File 2");'));

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        ...testConfigs.baseConfig,
        disableContextOptimization: false,
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(4);
    expect(result).toEqual([
      ...mockResponses.mockUpdateFile(`${mockData.paths.root}/test1.js`, 'console.log("File 1");'),
      ...mockResponses.mockUpdateFile(`${mockData.paths.root}/test2.js`, 'console.log("File 2");'),
    ]);
  });

  it('should handle empty context paths array', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).disableContextOptimization = false;

    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [{ filePath: mockData.paths.test, updateToolName: 'updateFile', prompt: 'Generate file' }],
          contextPaths: [], // Empty context paths
          explanation: 'Mock summary with no context',
        },
      },
    ];

    // Setup mocks for the entire flow
    vi.mocked(vertexAi.generateContent)
      // First mock for codegenPlanning
      .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.test))
      // Second mock for codegenSummary
      .mockResolvedValueOnce(mockCodegenSummary)
      // Third mock for the actual update
      .mockResolvedValueOnce(mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("No context needed");'));

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        ...testConfigs.baseConfig,
        disableContextOptimization: false,
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    expect(result).toEqual(mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("No context needed");'));
  });
});
