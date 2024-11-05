import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promptService } from './prompt-service.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as vertexAiClaude from '../ai-service/vertex-ai-claude.js';
import * as chatGpt from '../ai-service/chat-gpt.js';
import * as anthropic from '../ai-service/anthropic.js';
import * as cliParams from '../cli/cli-params.js';
import fs from 'fs';
import * as diff from 'diff';
import * as dalleService from '../ai-service/dall-e.js';
import * as vertexAiImagen from '../ai-service/vertex-ai-imagen.js';
import { getCodeGenPrompt } from './prompt-codegen.js';
import { AiServiceType, ImagenType } from '../main/codegen-types.js';
import { GenerateContentFunction, GenerateImageFunction } from '../ai-service/common.js';
import { mockData, mockResponses, testConfigs } from './prompt-service.test-utils.js';

// Mock all external dependencies
vi.mock('../ai-service/vertex-ai-claude.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/vertex-ai.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/chat-gpt.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/anthropic.js', () => ({ generateContent: vi.fn() }));
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
  'chat-gpt': chatGpt.generateContent,
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

      // Setup mocks
      vi.mocked(vertexAi.generateContent)
        // First mock for codegenPlanning
        .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.test))
        // Second mock for invalid codegenSummary
        .mockResolvedValueOnce(mockInvalidCall)
        // Third mock for valid codegenSummary
        .mockResolvedValueOnce(mockValidCall)
        // Fourth mock for the actual update
        .mockResolvedValueOnce(mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Recovered response");'));

      const result = await promptService(
        GENERATE_CONTENT_FNS,
        GENERATE_IMAGE_FNS,
        getCodeGenPrompt(testConfigs.baseConfig),
      );

      expect(vertexAi.generateContent).toHaveBeenCalledTimes(4);
      expect(result).toEqual(mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Recovered response");'));
    });

    it('should handle unsuccessful recovery', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';

      const mockInvalidCall = [
        {
          name: 'updateFile',
          args: { filePath: mockData.paths.test, invalidArg: 'This should not be here' },
        },
      ];

      // Setup mocks
      vi.mocked(vertexAi.generateContent)
        // First mock for codegenPlanning
        .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.test))
        // Second mock for codegenSummary
        .mockResolvedValueOnce([
          {
            name: 'codegenSummary',
            args: {
              fileUpdates: [{ filePath: mockData.paths.test, updateToolName: 'patchFile', prompt: 'Generate file' }],
              contextPaths: [],
              explanation: 'Mock summary',
            },
          },
        ])
        // Third, fourth, and fifth mocks for failed recovery attempts
        .mockResolvedValueOnce(mockInvalidCall)
        .mockResolvedValueOnce(mockInvalidCall)
        .mockResolvedValueOnce(mockInvalidCall);

      await expect(
        promptService(GENERATE_CONTENT_FNS, GENERATE_IMAGE_FNS, getCodeGenPrompt(testConfigs.baseConfig)),
      ).rejects.toThrow('Recovery failed');

      expect(vertexAi.generateContent).toHaveBeenCalledTimes(5);
    });

    it('should not attempt recovery for multiple valid function calls', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';

      // Setup mocks
      vi.mocked(vertexAi.generateContent)
        // First mock for codegenPlanning
        .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.test))
        // Second mock for codegenSummary with multiple files
        .mockResolvedValueOnce([
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
        ])
        // Third and fourth mocks for the actual updates
        .mockResolvedValueOnce(
          mockResponses.mockUpdateFile(`${mockData.paths.root}/test1.js`, 'console.log("File 1");'),
        )
        .mockResolvedValueOnce(
          mockResponses.mockUpdateFile(`${mockData.paths.root}/test2.js`, 'console.log("File 2");'),
        );

      const result = await promptService(
        GENERATE_CONTENT_FNS,
        GENERATE_IMAGE_FNS,
        getCodeGenPrompt(testConfigs.baseConfig),
      );

      expect(vertexAi.generateContent).toHaveBeenCalledTimes(4);
      expect(result).toEqual([
        ...mockResponses.mockUpdateFile(`${mockData.paths.root}/test1.js`, 'console.log("File 1");'),
        ...mockResponses.mockUpdateFile(`${mockData.paths.root}/test2.js`, 'console.log("File 2");'),
      ]);
    });
  });

  describe('Patch File Validation', () => {
    it('should handle invalid patchFile call and retry without patchFile function', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';

      // Setup mocks
      vi.mocked(vertexAi.generateContent)
        // First mock for codegenPlanning
        .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.test))
        // Second mock for codegenSummary
        .mockResolvedValueOnce([
          {
            name: 'codegenSummary',
            args: {
              fileUpdates: [
                {
                  filePath: mockData.paths.test,
                  updateToolName: 'patchFile',
                  prompt: 'Generate file',
                },
              ],
              contextPaths: [],
              explanation: 'Mock summary',
            },
          },
        ])
        // Third mock for invalid patch
        .mockResolvedValueOnce(mockResponses.mockPatchFile(mockData.paths.test, 'invalid patch'))
        // Fourth mock for recovery with updateFile
        .mockResolvedValueOnce(mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Updated content");'));

      // Mock fs.readFileSync to return some content
      vi.mocked(fs.readFileSync).mockReturnValue(mockData.fileContent);

      // Mock diff.applyPatch to fail for the invalid patch
      vi.mocked(diff.applyPatch).mockReturnValue(false);

      const result = await promptService(
        GENERATE_CONTENT_FNS,
        GENERATE_IMAGE_FNS,
        getCodeGenPrompt(testConfigs.baseConfig),
      );

      expect(vertexAi.generateContent).toHaveBeenCalledTimes(4);
      expect(fs.readFileSync).toHaveBeenCalledWith(mockData.paths.test, 'utf-8');
      expect(diff.applyPatch).toHaveBeenCalledWith(mockData.fileContent, 'invalid patch');
      expect(result).toEqual(mockResponses.mockUpdateFile(mockData.paths.test, 'console.log("Updated content");'));
    });

    it('should handle successful patch application', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';

      const validPatch = `Index: test.js
===================================================================
--- test.js
+++ test.js
@@ -1,1 +1,1 @@
-Original content
+New content`;

      // Setup mocks
      vi.mocked(vertexAi.generateContent)
        // First mock for codegenPlanning
        .mockResolvedValueOnce(mockResponses.mockPlanningResponse(mockData.paths.test))
        // Second mock for codegenSummary
        .mockResolvedValueOnce([
          {
            name: 'codegenSummary',
            args: {
              fileUpdates: [
                {
                  filePath: mockData.paths.test,
                  updateToolName: 'patchFile',
                  prompt: 'Generate file',
                },
              ],
              contextPaths: [],
              explanation: 'Mock summary',
            },
          },
        ])
        // Third mock for valid patch
        .mockResolvedValueOnce(mockResponses.mockPatchFile(mockData.paths.test, validPatch));

      // Mock fs.readFileSync to return some content
      vi.mocked(fs.readFileSync).mockReturnValue(mockData.fileContent);

      // Mock diff.applyPatch to succeed with the valid patch
      vi.mocked(diff.applyPatch).mockReturnValue('New content');

      const result = await promptService(
        GENERATE_CONTENT_FNS,
        GENERATE_IMAGE_FNS,
        getCodeGenPrompt(testConfigs.baseConfig),
      );

      expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
      expect(fs.readFileSync).toHaveBeenCalledWith(mockData.paths.test, 'utf-8');
      expect(diff.applyPatch).toHaveBeenCalledWith(mockData.fileContent, validPatch);
      expect(result).toEqual(mockResponses.mockPatchFile(mockData.paths.test, validPatch));
    });
  });
});
