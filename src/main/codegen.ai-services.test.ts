import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runCodegen } from './codegen.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as openai from '../ai-service/openai.js';
import * as anthropic from '../ai-service/anthropic.js';
import * as vertexAiClaude from '../ai-service/vertex-ai-claude.js';
import * as updateFiles from '../files/update-files.js';
import * as cliParams from '../cli/cli-params.js';
import '../files/find-files.js';
import '../files/cache-file.js';
import './config.js';

import {
  createMockPlanningResponse,
  createMockCodegenSummary,
  createMockFileUpdate,
  createMockResponseSequence,
} from './codegen.test-utils.js';
import { ModelType, GenerateContentResultPart } from '../ai-service/common-types.js';

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
vi.mock('../ai-service/openai.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/anthropic.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/vertex-ai-claude.js', () => ({ generateContent: vi.fn() }));
vi.mock('../files/update-files.js', () => ({ updateFiles: vi.fn().mockResolvedValue([]) }));
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
  modelOverrides: {},
}));

describe('AI Services Integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cliParams).aiService = undefined;
    vi.mocked(cliParams).dryRun = false;
    vi.mocked(cliParams).helpRequested = false;
    vi.mocked(cliParams).vision = false;
    vi.mocked(cliParams).imagen = undefined;
    vi.mocked(cliParams).cheap = false;
    vi.mocked(cliParams).temperature = 0.7;
    vi.mocked(cliParams).explicitPrompt = 'test';
  });

  describe('Vertex AI', () => {
    it('should run codegen with Vertex AI by default', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';

      const mockPlanning = createMockPlanningResponse('Test analysis for Vertex AI', 'Update test.js file', [
        { filePath: '/mocked/root/dir/test.js', reason: 'Test update' },
      ]);

      const mockSummary = createMockCodegenSummary(
        [{ filePath: '/mocked/root/dir/test.js', updateToolName: 'updateFile', prompt: 'Update file content' }],
        [],
        'Test file update',
      );

      const mockUpdate = createMockFileUpdate('updateFile', {
        filePath: '/mocked/root/dir/test.js',
        newContent: 'console.log("Hello");',
      });

      const mockSequence = createMockResponseSequence(mockPlanning, mockSummary, [mockUpdate]);
      mockSequence.forEach((response) => {
        const resultParts: GenerateContentResultPart[] = response.map((fc) => ({
          type: 'functionCall',
          functionCall: fc,
        }));
        vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(resultParts);
      });

      await runCodegen();

      // Verify all phases were called
      expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
      expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockUpdate, expect.anything());
    });
  });

  describe('OpenAI', () => {
    it('should run codegen with OpenAI when specified', async () => {
      vi.mocked(cliParams).aiService = 'openai';

      const mockPlanning = createMockPlanningResponse('Test analysis for OpenAI', 'Create new.js file', [
        { filePath: '/mocked/root/dir/new.js', reason: 'New file creation' },
      ]);

      const mockSummary = createMockCodegenSummary(
        [{ filePath: '/mocked/root/dir/new.js', updateToolName: 'createFile', prompt: 'Create new file' }],
        [],
        'Create new test file',
      );

      const mockCreate = createMockFileUpdate('createFile', {
        filePath: '/mocked/root/dir/new.js',
        newContent: 'const x = 5;',
      });

      const mockSequence = createMockResponseSequence(mockPlanning, mockSummary, [mockCreate]);
      mockSequence.forEach((response) => {
        const resultParts: GenerateContentResultPart[] = response.map((fc) => ({
          type: 'functionCall',
          functionCall: fc,
        }));
        vi.mocked(openai.generateContent).mockResolvedValueOnce(resultParts);
      });

      await runCodegen();

      expect(openai.generateContent).toHaveBeenCalledTimes(3);
      expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockCreate, expect.anything());
    });
  });

  describe('Anthropic', () => {
    it('should run codegen with Anthropic when specified', async () => {
      vi.mocked(cliParams).aiService = 'anthropic';

      const mockPlanning = createMockPlanningResponse('Test analysis for Anthropic', 'Delete obsolete.js file', [
        { filePath: '/mocked/root/dir/obsolete.js', reason: 'File removal' },
      ]);

      const mockSummary = createMockCodegenSummary(
        [{ filePath: '/mocked/root/dir/obsolete.js', updateToolName: 'deleteFile', prompt: 'Remove obsolete file' }],
        [],
        'Remove test file',
      );

      const mockDelete = createMockFileUpdate('deleteFile', {
        filePath: '/mocked/root/dir/obsolete.js',
      });

      const mockSequence = createMockResponseSequence(mockPlanning, mockSummary, [mockDelete]);
      mockSequence.forEach((response) => {
        const resultParts: GenerateContentResultPart[] = response.map((fc) => ({
          type: 'functionCall',
          functionCall: fc,
        }));
        vi.mocked(anthropic.generateContent).mockResolvedValueOnce(resultParts);
      });

      await runCodegen();

      expect(anthropic.generateContent).toHaveBeenCalledTimes(3);
      expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockDelete, expect.anything());
    });
  });

  describe('Vertex AI Claude', () => {
    it('should run codegen with Vertex AI Claude when specified', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai-claude';

      const mockPlanning = createMockPlanningResponse(
        'Test analysis for Vertex AI Claude',
        'Update test.js with Claude',
        [{ filePath: '/mocked/root/dir/test.js', reason: 'Claude test update' }],
      );

      const mockSummary = createMockCodegenSummary(
        [{ filePath: '/mocked/root/dir/test.js', updateToolName: 'updateFile', prompt: 'Update with Claude' }],
        [],
        'Claude test update',
      );

      const mockUpdate = createMockFileUpdate('updateFile', {
        filePath: '/mocked/root/dir/test.js',
        newContent: 'console.log("Hello from Claude");',
      });

      const mockSequence = createMockResponseSequence(mockPlanning, mockSummary, [mockUpdate]);
      mockSequence.forEach((response) => {
        const resultParts: GenerateContentResultPart[] = response.map((fc) => ({
          type: 'functionCall',
          functionCall: fc,
        }));
        vi.mocked(vertexAiClaude.generateContent).mockResolvedValueOnce(resultParts);
      });

      await runCodegen();

      expect(vertexAiClaude.generateContent).toHaveBeenCalledTimes(3);
      expect(updateFiles.updateFiles).toHaveBeenCalledWith(mockUpdate, expect.anything());
    });
  });

  describe('AI Service Parameters', () => {
    it('should pass the temperature parameter to the AI service', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';
      vi.mocked(cliParams).temperature = 0.5;

      const mockPlanning = createMockPlanningResponse();
      const mockSummary = createMockCodegenSummary();
      const mockUpdate = createMockFileUpdate('updateFile', {
        filePath: 'test.js',
        newContent: 'console.log("Temperature test");',
      });

      const mockSequence = createMockResponseSequence(mockPlanning, mockSummary, [mockUpdate]);
      mockSequence.forEach((response) => {
        const resultParts: GenerateContentResultPart[] = response.map((fc) => ({
          type: 'functionCall',
          functionCall: fc,
        }));
        vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(resultParts);
      });

      await runCodegen();

      // Verify temperature parameter in each call
      const calls = vi.mocked(vertexAi.generateContent).mock.calls;
      calls.forEach((call) => {
        // Access temperature from the config object (second argument)
        expect(call[1].temperature).toBe(0.5);
      });
    });

    it('should pass the cheap parameter to the AI service when --cheap flag is true', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';
      vi.mocked(cliParams).cheap = true;

      const mockPlanning = createMockPlanningResponse();
      const mockSummary = createMockCodegenSummary();
      const mockUpdate = createMockFileUpdate('updateFile', {
        filePath: 'test.js',
        newContent: 'console.log("Cheap test");',
      });

      const mockSequence = createMockResponseSequence(mockPlanning, mockSummary, [mockUpdate]);
      mockSequence.forEach((response) => {
        const resultParts: GenerateContentResultPart[] = response.map((fc) => ({
          type: 'functionCall',
          functionCall: fc,
        }));
        vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(resultParts);
      });

      await runCodegen();

      // Verify cheap parameter in each call
      const calls = vi.mocked(vertexAi.generateContent).mock.calls;
      calls.forEach((call) => {
        // Access modelType from the config object (second argument)
        expect(call[1].modelType).toBe(ModelType.CHEAP);
      });
    });
  });
});
