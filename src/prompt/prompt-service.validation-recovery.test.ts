import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promptService } from './prompt-service.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as vertexAiClaude from '../ai-service/vertex-ai-claude.js';
import * as openai from '../ai-service/openai.js';
import * as anthropic from '../ai-service/anthropic.js';
import * as localLlm from '../ai-service/local-llm.js';
import * as cliParams from '../cli/cli-params.js';
import fs from 'fs';
import * as diff from 'diff';
import * as dalleService from '../ai-service/dall-e.js';
import * as vertexAiImagen from '../ai-service/vertex-ai-imagen.js';
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
vi.mock('fs');
vi.mock('diff');
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

describe('promptService - Validation and Recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cliParams).dryRun = false;
    vi.mocked(cliParams).vision = false;
    vi.mocked(cliParams).imagen = undefined;
    vi.mocked(cliParams).disableContextOptimization = true;
    vi.mocked(cliParams).explicitPrompt = 'testx';
  });

  describe('Invalid Response Recovery', () => {
    it('should successfully recover from an invalid function call', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';

      const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.test);
      // Invalid: 'files' instead of 'fileUpdates'
      const mockInvalidCall = [
        {
          name: 'codegenSummary',
          args: {
            files: [{ filePath: mockData.paths.test, updateToolName: 'updateFile' }],
            contextPaths: [],
            explanation: 'Mock summary',
          },
        },
      ];

      // Valid call for recovery
      const mockValidCall = [
        {
          name: 'codegenSummary',
          args: {
            fileUpdates: [{ filePath: mockData.paths.test, updateToolName: 'updateFile', prompt: 'Generate file' }],
            contextPaths: [],
            explanation: 'Mock summary',
          },
        },
      ];
      const updateResponse = mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Recovered response");');

      // Setup mocks
      vi.mocked(vertexAi.generateContent)
        .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(mockInvalidCall.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(mockValidCall.map((fc) => ({ type: 'functionCall', functionCall: fc }))) // Recovery call
        .mockResolvedValueOnce(updateResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })));

      const result = await promptService(
        GENERATE_CONTENT_FNS,
        GENERATE_IMAGE_FNS,
        getCodeGenPrompt(testConfigs.baseConfig),
      );

      // Planning, Invalid Summary, Valid Summary (recovery), Update
      expect(vertexAi.generateContent).toHaveBeenCalledTimes(4);
      expect(result).toEqual(updateResponse);
    });

    it('should handle unsuccessful recovery', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';

      const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.test);
      const summaryResponse = mockResponses.mockCodegenSummary(mockData.paths.test);
      // Mock an invalid response that will trigger validation failure
      const mockInvalidCall = [
        {
          name: 'updateFile',
          args: {}, // Missing all required fields
        },
      ];
      // Mock responses for repeated invalid attempts
      const mockRepeatedInvalidCall = [
        {
          name: 'updateFile',
          args: { filePath: mockData.paths.test }, // Still missing required fields
        },
      ];

      // Setup mocks with consistently invalid responses
      vi.mocked(vertexAi.generateContent)
        .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(summaryResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(mockInvalidCall.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(mockRepeatedInvalidCall.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(mockInvalidCall.map((fc) => ({ type: 'functionCall', functionCall: fc }))); // Last attempt also fails

      const result = await promptService(
        GENERATE_CONTENT_FNS,
        GENERATE_IMAGE_FNS,
        getCodeGenPrompt(testConfigs.baseConfig),
      );
      expect(result).toEqual([]); // Expect empty result after failed recovery

      // Planning, Summary, UpdateAttempt1, UpdateAttempt2, UpdateAttempt3
      expect(vertexAi.generateContent).toHaveBeenCalledTimes(5);
    });

    it('should not attempt recovery for multiple valid function calls', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';

      const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.test);
      const mockCodegenSummaryResult = [
        {
          name: 'codegenSummary',
          args: {
            fileUpdates: [
              {
                filePath: `${mockData.paths.root}/test1.js`,
                updateToolName: 'updateFile',
                prompt: 'Generate file 1',
              },
              {
                filePath: `${mockData.paths.root}/test2.js`,
                updateToolName: 'updateFile',
                prompt: 'Generate file 2',
              },
            ],
            contextPaths: [],
            explanation: 'Mock summary',
          },
        },
      ];
      const update1Response = mockResponses.mockUpdateFile(`${mockData.paths.root}/test1.js`, 'console.log("File 1");');
      const update2Response = mockResponses.mockUpdateFile(`${mockData.paths.root}/test2.js`, 'console.log("File 2");');

      // Setup mocks
      vi.mocked(vertexAi.generateContent)
        .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(mockCodegenSummaryResult.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(update1Response.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(update2Response.map((fc) => ({ type: 'functionCall', functionCall: fc })));

      const result = await promptService(
        GENERATE_CONTENT_FNS,
        GENERATE_IMAGE_FNS,
        getCodeGenPrompt(testConfigs.baseConfig),
      );

      // Planning, Summary, Update1, Update2
      expect(vertexAi.generateContent).toHaveBeenCalledTimes(4);
      expect(result).toEqual([...update1Response, ...update2Response]);
    });
  });

  describe('Patch File Validation', () => {
    it('should handle invalid patchFile call and retry without patchFile function', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';

      const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.test);
      const summaryResponse = mockResponses.mockCodegenSummary(mockData.paths.test, 'patchFile');
      const invalidPatchResponse = mockResponses.mockPatchFile(mockData.paths.test, 'invalid patch');
      // Recovery response using updateFile
      const updateResponse = mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Updated content");');

      // Setup mocks
      vi.mocked(vertexAi.generateContent)
        .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(summaryResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(invalidPatchResponse.map((fc) => ({ type: 'functionCall', functionCall: fc }))) // Invalid patch attempt
        .mockResolvedValueOnce(updateResponse.map((fc) => ({ type: 'functionCall', functionCall: fc }))); // Recovery with updateFile

      vi.mocked(fs.readFileSync).mockReturnValue(mockData.fileContent);
      vi.mocked(diff.applyPatch).mockReturnValue(false); // Simulate patch failure

      const result = await promptService(
        GENERATE_CONTENT_FNS,
        GENERATE_IMAGE_FNS,
        getCodeGenPrompt(testConfigs.baseConfig),
      );

      // Planning, Summary, Invalid Patch, Recovery Update
      expect(vertexAi.generateContent).toHaveBeenCalledTimes(4);
      expect(fs.readFileSync).toHaveBeenCalledWith(mockData.paths.test, 'utf-8');
      expect(diff.applyPatch).toHaveBeenCalledWith(mockData.fileContent, 'invalid patch');
      expect(result).toEqual(updateResponse);
    });

    it('should handle successful patch application', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';

      const validPatch = `Index: test.js\n===================================================================\n--- test.js\n+++ test.js\n@@ -1,1 +1,1 @@\n-Original content\n+New content`;
      const planningResponse = mockResponses.mockPlanningResponse(mockData.paths.test);
      const summaryResponse = mockResponses.mockCodegenSummary(mockData.paths.test, 'patchFile');
      const patchResponse = mockResponses.mockPatchFile(mockData.paths.test, validPatch);

      // Setup mocks
      vi.mocked(vertexAi.generateContent)
        .mockResolvedValueOnce(planningResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(summaryResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })))
        .mockResolvedValueOnce(patchResponse.map((fc) => ({ type: 'functionCall', functionCall: fc })));

      vi.mocked(fs.readFileSync).mockReturnValue(mockData.fileContent);
      vi.mocked(diff.applyPatch).mockReturnValue('New content'); // Simulate successful patch

      const result = await promptService(
        GENERATE_CONTENT_FNS,
        GENERATE_IMAGE_FNS,
        getCodeGenPrompt(testConfigs.baseConfig),
      );

      // Planning, Summary, Patch
      expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
      expect(fs.readFileSync).toHaveBeenCalledWith(mockData.paths.test, 'utf-8');
      expect(diff.applyPatch).toHaveBeenCalledWith(mockData.fileContent, validPatch);
      // Expect the result to be the patchFile call, but with oldContent and newContent added by the validation step
      expect(result).toEqual(
        mockResponses.mockPatchFile(mockData.paths.test, validPatch, {
          oldContent: mockData.fileContent,
          newContent: 'New content',
        }),
      );
    });
  });
});
