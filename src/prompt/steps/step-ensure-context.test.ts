import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeStepEnsureContext } from './step-ensure-context';
import { getSourceCode } from '../../files/read-files';
import { putSystemMessage } from '../../main/common/content-bus';
import { StepResult } from './steps-types';
import { CodegenOptions } from '../../main/codegen-types';
import '../../files/find-files.js';
import { PromptItem } from '../../ai-service/common';

import { importantContext } from '../../main/config.js';

// Mock dependencies
vi.mock('../../files/read-files');
vi.mock('../../files/find-files.js', () => ({
  getSourceFiles: () => [],
  getImageAssetFiles: () => [],
  refreshFiles: () => null,
}));
vi.mock('../../main/common/content-bus');
vi.mock('../../main/config.js', () => ({
  rootDir: '/test',
  rcConfig: {
    rootDir: '/test',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
  },
  importantContext: {
    files: ['/test/important.ts'],
  },
}));

describe('executeStepEnsureContext', () => {
  const mockOptions: CodegenOptions = {
    aiService: 'vertex-ai',
    askQuestion: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    importantContext.files = ['/test/important.ts'];
  });

  describe('Path extraction from codegenSummary', () => {
    it('should extract paths from fileUpdates and contextPaths', async () => {
      const mockCodegenSummary = {
        name: 'codegenSummary',
        args: {
          fileUpdates: [{ filePath: '/test/file1.ts' }, { filePath: '/test/file2.ts' }],
          contextPaths: ['/test/context1.ts', '/test/context2.ts'],
          explanation: 'test',
        },
      };

      vi.mocked(getSourceCode).mockReturnValue({
        '/test/file1.ts': { content: 'content1' },
        '/test/file2.ts': { content: 'content2' },
        '/test/context1.ts': { content: 'context1' },
        '/test/context2.ts': { content: 'context2' },
        '/test/important.ts': { content: 'important' },
      });

      const prompt: PromptItem[] = [];
      const result = await executeStepEnsureContext(prompt, mockCodegenSummary, mockOptions);

      expect(result).toBe(StepResult.CONTINUE);
      expect(getSourceCode).toHaveBeenCalledWith(
        expect.objectContaining({
          filterPaths: expect.arrayContaining([
            '/test/file1.ts',
            '/test/file2.ts',
            '/test/context1.ts',
            '/test/context2.ts',
            '/test/important.ts',
          ]),
        }),
        mockOptions,
      );
    });

    it('should handle empty fileUpdates and contextPaths', async () => {
      importantContext.files = [];

      const mockCodegenSummary = {
        name: 'codegenSummary',
        args: {
          fileUpdates: [],
          contextPaths: [],
          explanation: 'test',
        },
      };

      vi.mocked(getSourceCode).mockReturnValue({});

      const prompt: PromptItem[] = [];
      const result = await executeStepEnsureContext(prompt, mockCodegenSummary, mockOptions);

      expect(result).toBe(StepResult.CONTINUE);
      expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('No paths to ensure'));
    });
  });

  describe('Context checking in conversation', () => {
    it('should identify files already in context', async () => {
      const mockCodegenSummary = {
        name: 'codegenSummary',
        args: {
          fileUpdates: [{ filePath: '/test/file1.ts' }],
          contextPaths: ['/test/context1.ts'],
          explanation: 'test',
        },
      };

      const prompt = [
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify({
                '/test': {
                  'file1.ts': { content: 'existing content' },
                },
              }),
            },
          ],
        },
      ];

      vi.mocked(getSourceCode).mockReturnValue({
        '/test/context1.ts': { content: 'context1' },
        '/test/important.ts': { content: 'important' },
      });

      const result = await executeStepEnsureContext(prompt, mockCodegenSummary, mockOptions);

      expect(result).toBe(StepResult.CONTINUE);
      expect(getSourceCode).toHaveBeenCalledWith(
        expect.objectContaining({
          filterPaths: expect.arrayContaining(['/test/context1.ts', '/test/important.ts']),
        }),
        mockOptions,
      );
    });

    it('should handle both content and summary in context', async () => {
      const mockCodegenSummary = {
        name: 'codegenSummary',
        args: {
          fileUpdates: [{ filePath: '/test/file1.ts' }],
          contextPaths: ['/test/context1.ts'],
          explanation: 'test',
        },
      };

      const prompt = [
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify({
                '/test': {
                  'file1.ts': { content: 'existing content' },
                  'context1.ts': { summary: 'summary only' },
                },
              }),
            },
          ],
        },
      ];

      vi.mocked(getSourceCode).mockReturnValue({
        '/test/context1.ts': { content: 'context1' },
        '/test/important.ts': { content: 'important' },
      });

      const result = await executeStepEnsureContext(prompt, mockCodegenSummary, mockOptions);

      expect(result).toBe(StepResult.CONTINUE);
      expect(getSourceCode).toHaveBeenCalledWith(
        expect.objectContaining({
          filterPaths: expect.arrayContaining(['/test/context1.ts', '/test/important.ts']),
        }),
        mockOptions,
      );
    });
  });

  describe('getSourceCode appending', () => {
    it('should append getSourceCode call/response for missing files', async () => {
      const mockCodegenSummary = {
        name: 'codegenSummary',
        args: {
          fileUpdates: [{ filePath: '/test/new1.ts' }],
          contextPaths: ['/test/new2.ts'],
          explanation: 'test',
        },
      };

      const prompt: PromptItem[] = [];
      vi.mocked(getSourceCode).mockReturnValue({
        '/test/new1.ts': { content: 'new1' },
        '/test/new2.ts': { content: 'new2' },
        '/test/important.ts': { content: 'important' },
      });

      await executeStepEnsureContext(prompt, mockCodegenSummary, mockOptions);

      expect(prompt).toHaveLength(2);
      expect(prompt[0].type).toBe('assistant');
      expect(prompt[0].functionCalls?.[0].name).toBe('getSourceCode');
      expect(prompt[1].type).toBe('user');
      expect(prompt[1].functionResponses?.[0].name).toBe('getSourceCode');
      expect(JSON.parse(prompt[1].functionResponses?.[0].content ?? '')).toEqual({
        '/test': {
          'new1.ts': { content: 'new1' },
          'new2.ts': { content: 'new2' },
          'important.ts': { content: 'important' },
        },
      });
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle invalid getSourceCode responses in context', async () => {
      console.warn = vi.fn();

      const mockCodegenSummary = {
        name: 'codegenSummary',
        args: {
          fileUpdates: [{ filePath: '/test/file1.ts' }],
          contextPaths: [],
          explanation: 'test',
        },
      };

      const prompt = [
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: 'invalid json',
            },
          ],
        },
      ];

      vi.mocked(getSourceCode).mockReturnValue({
        '/test/file1.ts': { content: 'content1' },
        '/test/important.ts': { content: 'important' },
      });

      const result = await executeStepEnsureContext(prompt, mockCodegenSummary, mockOptions);

      expect(result).toBe(StepResult.CONTINUE);
      expect(console.warn).toHaveBeenCalledWith('Failed to parse getSourceCode response:', expect.any(Error));
    });

    it('should handle missing args in codegenSummary', async () => {
      const mockCodegenSummary = {
        name: 'codegenSummary',
        args: {},
      };

      const prompt: PromptItem[] = [];
      const result = await executeStepEnsureContext(prompt, mockCodegenSummary, mockOptions);

      expect(result).toEqual(StepResult.BREAK);
    });

    it('should handle getSourceCode errors', async () => {
      const mockCodegenSummary = {
        name: 'codegenSummary',
        args: {
          fileUpdates: [{ filePath: '/test/file1.ts' }],
          contextPaths: [],
          explanation: 'test',
        },
      };

      vi.mocked(getSourceCode).mockImplementation(() => {
        throw new Error('Mock error');
      });

      const prompt: PromptItem[] = [];
      const result = await executeStepEnsureContext(prompt, mockCodegenSummary, mockOptions);

      expect(result).toBe(StepResult.BREAK);
      expect(putSystemMessage).toHaveBeenCalledWith('Error: Context completeness check failed. This is unexpected.');
    });
  });
});