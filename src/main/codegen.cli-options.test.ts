import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runCodegen } from './codegen.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as updateFiles from '../files/update-files.js';
import * as cliParams from '../cli/cli-params.js';
import * as cliOptions from '../cli/cli-options.js';
import '../files/find-files.js';
import '../files/cache-file.js';
import './config.js';

import {
  createMockPlanningResponse,
  createMockCodegenSummary,
  createMockFileUpdate,
  createMockResponseSequence,
} from './codegen.test-utils.js';
import { rcConfig } from './config.js';

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
vi.mock('../files/update-files.js');
vi.mock('../files/cache-file.js');
vi.mock('../cli/cli-options.js', () => ({
  printHelpMessage: vi.fn(),
}));
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
    lintCommand: 'echo "mock lint"',
  },
  importantContext: {},
  modelOverrides: {},
}));

describe('CLI Options', () => {
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

  describe('Help Option', () => {
    it('should print help message and not run codegen when --help option is provided', async () => {
      vi.mocked(cliParams).helpRequested = true;

      await runCodegen();

      expect(cliOptions.printHelpMessage).toHaveBeenCalled();
      expect(vertexAi.generateContent).not.toHaveBeenCalled();
      expect(updateFiles.updateFiles).not.toHaveBeenCalled();
    });
  });

  describe('Dry Run Mode', () => {
    it('should not update files in dry run mode but should still plan and analyze', async () => {
      vi.mocked(cliParams).dryRun = true;
      vi.mocked(cliParams).aiService = 'vertex-ai';

      const mockPlanning = createMockPlanningResponse('Test analysis for dry run', 'Update test.js file', [
        { filePath: '/mocked/root/dir/test.js', reason: 'Test update' },
      ]);

      const mockSummary = createMockCodegenSummary(
        [{ filePath: '/mocked/root/dir/test.js', updateToolName: 'updateFile', prompt: 'Update file content' }],
        [],
        'Test file update',
      );

      const mockUpdate = createMockFileUpdate('updateFile', {
        filePath: '/mocked/root/dir/test.js',
        newContent: 'console.log("Dry run");',
      });

      const mockSequence = createMockResponseSequence(mockPlanning, mockSummary, [mockUpdate]);
      mockSequence.forEach((response) => {
        vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(response);
      });

      await runCodegen();

      expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
      expect(updateFiles.updateFiles).not.toHaveBeenCalled();
    });
  });

  describe('Temperature Setting', () => {
    it('should use custom temperature value when specified', async () => {
      vi.mocked(cliParams).temperature = 0.3;
      vi.mocked(cliParams).aiService = 'vertex-ai';

      const mockPlanning = createMockPlanningResponse('Test analysis with custom temperature', 'Update test.js file', [
        { filePath: '/mocked/root/dir/test.js', reason: 'Temperature test' },
      ]);

      const mockSummary = createMockCodegenSummary(
        [
          {
            filePath: '/mocked/root/dir/test.js',
            updateToolName: 'updateFile',
            prompt: 'Update with custom temperature',
          },
        ],
        [],
        'Temperature test update',
      );

      const mockUpdate = createMockFileUpdate('updateFile', {
        filePath: '/mocked/root/dir/test.js',
        newContent: 'console.log("Custom temperature");',
      });

      const mockSequence = createMockResponseSequence(mockPlanning, mockSummary, [mockUpdate]);
      mockSequence.forEach((response) => {
        vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(response);
      });

      await runCodegen();

      const calls = vi.mocked(vertexAi.generateContent).mock.calls;
      calls.forEach((call) => {
        expect(call[3]).toBe(0.3); // Check temperature parameter
      });
    });
  });

  describe('Context Optimization', () => {
    it('should respect disableContextOptimization flag', async () => {
      vi.mocked(cliParams).disableContextOptimization = false;
      vi.mocked(cliParams).aiService = 'vertex-ai';
      vi.mocked(rcConfig).lintCommand = undefined;

      const mockPlanning = createMockPlanningResponse(
        'Test analysis with context optimization',
        'Update test.js file',
        [{ filePath: '/mocked/root/dir/test.js', reason: 'Context optimization test' }],
      );

      const mockSummary = createMockCodegenSummary(
        [{ filePath: '/mocked/root/dir/test.js', updateToolName: 'updateFile', prompt: 'Update with optimization' }],
        ['/mocked/root/dir/context.js'], // Additional context paths
        'Context optimization test',
      );

      const mockUpdate = createMockFileUpdate('updateFile', {
        filePath: '/mocked/root/dir/test.js',
        newContent: 'console.log("Optimized context");',
      });

      const mockSequence = createMockResponseSequence(mockPlanning, mockSummary, [mockUpdate]);
      mockSequence.forEach((response) => {
        vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(response);
      });

      await runCodegen();

      expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
      // Check if context paths were included in the call
      const calls = vi.mocked(vertexAi.generateContent).mock.calls;
      expect(calls[1][0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'user',
            functionResponses: expect.arrayContaining([
              expect.objectContaining({
                name: 'getSourceCode',
              }),
            ]),
          }),
        ]),
      );
    });
  });
});
