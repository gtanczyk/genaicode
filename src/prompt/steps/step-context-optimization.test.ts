import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeStepContextOptimization } from './step-context-optimization';
import { getSourceCode } from '../../files/read-files';
import { getSourceCodeTree, parseSourceCodeTree, SourceCodeTree } from '../../files/source-code-tree';
import { StepResult } from './steps-types';
import { CodegenOptions } from '../../main/codegen-types';
import { putSystemMessage } from '../../main/common/content-bus';
import '../../main/config.js';
import '../../files/find-files.js';

// Mock dependencies
vi.mock('../../files/read-files');
vi.mock('../../files/find-files.js', () => ({
  getSourceFiles: () => [],
  getImageAssetFiles: () => [],
  refreshFiles: () => null,
}));
vi.mock('../../files/source-code-tree');
vi.mock('../../main/common/content-bus');
vi.mock('../token-estimator', () => ({
  estimateTokenCount: vi.fn().mockReturnValue(100),
}));
vi.mock('./step-summarization', () => ({
  getSummary: vi.fn().mockReturnValue({ summary: 'Test summary' }),
}));
vi.mock('../../main/config.js', () => ({
  rootDir: '/test',
  rcConfig: {
    rootDir: '/test',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
  },
  importantContext: {},
  sourceExtensions: ['.ts'],
}));

describe('executeStepContextOptimization', () => {
  const mockGenerateContentFn = vi.fn().mockResolvedValue([]);
  const mockOptions: CodegenOptions = {
    aiService: 'vertex-ai',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Source code tree transformation', () => {
    it('should correctly transform source code between flat and tree structures', async () => {
      // Mock source code data
      const mockSourceCode = {
        '/test/file1.ts': { content: 'content1' },
        '/test/file2.ts': { content: 'content2' },
      };

      const mockSourceCodeTree = {
        '/test': {
          'file1.ts': ['content1'],
          'file2.ts': ['content2'],
        },
      } as SourceCodeTree;

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);
      vi.mocked(getSourceCodeTree).mockReturnValue(mockSourceCodeTree);
      vi.mocked(parseSourceCodeTree).mockReturnValue(mockSourceCode);

      // Mock the optimization response
      mockGenerateContentFn.mockResolvedValue([
        {
          name: 'optimizeContext',
          args: {
            userPrompt: 'test prompt',
            optimizedContext: [
              { filePath: '/test/file1.ts', relevance: 0.9, tokenCount: 50 },
              { filePath: '/test/file2.ts', relevance: 0.8, tokenCount: 40 },
            ],
          },
        },
      ]);

      const result = await executeStepContextOptimization(
        mockGenerateContentFn,
        [
          {
            type: 'user',
            functionResponses: [
              {
                name: 'getSourceCode',
                content: JSON.stringify(mockSourceCodeTree),
              },
            ],
          },
        ],
        mockOptions,
      );

      expect(result).toBe(StepResult.CONTINUE);
      expect(getSourceCodeTree).toHaveBeenCalled();
      expect(parseSourceCodeTree).toHaveBeenCalled();
    });

    it('should handle empty source code tree', async () => {
      vi.mocked(getSourceCode).mockReturnValue({});
      vi.mocked(getSourceCodeTree).mockReturnValue({});
      vi.mocked(parseSourceCodeTree).mockReturnValue({});

      const result = await executeStepContextOptimization(
        mockGenerateContentFn,
        [
          {
            type: 'user',
            functionResponses: [
              {
                name: 'getSourceCode',
                content: '{}',
              },
            ],
          },
        ],
        mockOptions,
      );

      expect(result).toBe(StepResult.CONTINUE);
      expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('Context optimization is starting'));
      expect(putSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining('Context optimization failed to produce useful summaries for all batches'),
      );
    });
  });

  describe('Context optimization process', () => {
    it('should optimize context based on relevance scores', async () => {
      const mockSourceCode = {
        '/test/high-relevance.ts': { content: 'important content' },
        '/test/medium-relevance.ts': { content: 'somewhat important' },
        '/test/low-relevance.ts': { content: 'not important' },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);
      vi.mocked(parseSourceCodeTree).mockReturnValue(mockSourceCode);

      mockGenerateContentFn.mockResolvedValue([
        {
          name: 'optimizeContext',
          args: {
            userPrompt: 'test prompt',
            optimizedContext: [
              { filePath: '/test/high-relevance.ts', relevance: 0.9, tokenCount: 50 },
              { filePath: '/test/medium-relevance.ts', relevance: 0.6, tokenCount: 40 },
              { filePath: '/test/low-relevance.ts', relevance: 0.2, tokenCount: 30 },
            ],
          },
        },
      ]);

      const result = await executeStepContextOptimization(
        mockGenerateContentFn,
        [
          {
            type: 'user',
            functionResponses: [
              {
                name: 'getSourceCode',
                content: JSON.stringify(getSourceCodeTree(mockSourceCode)),
              },
            ],
          },
        ],
        mockOptions,
      );

      expect(result).toBe(StepResult.CONTINUE);
      expect(putSystemMessage).toHaveBeenCalledWith(
        'Context optimization in progress.',
        expect.arrayContaining(['/test/high-relevance.ts']),
      );
    });

    it('should handle optimization failure gracefully', async () => {
      vi.mocked(getSourceCode).mockReturnValue({
        '/test/file.ts': { content: 'test content' },
      });

      mockGenerateContentFn.mockResolvedValue([
        {
          name: 'optimizeContext',
          args: {
            userPrompt: 'test prompt',
            optimizedContext: [], // Empty context indicates optimization failure
          },
        },
      ]);

      const result = await executeStepContextOptimization(
        mockGenerateContentFn,
        [
          {
            type: 'user',
            functionResponses: [
              {
                name: 'getSourceCode',
                content: '{"test": "content"}',
              },
            ],
          },
        ],
        mockOptions,
      );

      expect(result).toBe(StepResult.CONTINUE);
      expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('Warning: Context optimization failed'));
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle missing source code response', async () => {
      const consoleSpy = vi.spyOn(console, 'warn');

      const result = await executeStepContextOptimization(
        mockGenerateContentFn,
        [], // Empty prompt array
        mockOptions,
      );

      expect(result).toBe(StepResult.CONTINUE);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Could not find source code response'));
    });

    it('should handle invalid JSON in source code response', async () => {
      expect(
        executeStepContextOptimization(
          mockGenerateContentFn,
          [
            {
              type: 'user',
              functionResponses: [
                {
                  name: 'getSourceCode',
                  content: 'invalid json',
                },
              ],
            },
          ],
          mockOptions,
        ),
      ).rejects.toThrowError('Unexpected token i in JSON at position 0');
    });

    it('should handle errors during optimization process', async () => {
      vi.mocked(getSourceCode).mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      expect(
        executeStepContextOptimization(
          mockGenerateContentFn,
          [
            {
              type: 'user',
              functionResponses: [
                {
                  name: 'getSourceCode',
                  content: '{}',
                },
              ],
            },
          ],
          mockOptions,
        ),
      ).rejects.toThrowError('Unexpected error');
    });
  });

  describe('Token count handling', () => {
    it('should respect MAX_TOTAL_TOKENS limit', async () => {
      const mockSourceCode = {
        '/test/file1.ts': { content: 'large content' },
        '/test/file2.ts': { content: 'small content' },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);
      vi.mocked(parseSourceCodeTree).mockReturnValue(mockSourceCode);

      mockGenerateContentFn.mockResolvedValue([
        {
          name: 'optimizeContext',
          args: {
            userPrompt: 'test prompt',
            optimizedContext: [
              { filePath: '/test/file1.ts', relevance: 0.8, tokenCount: 9000 },
              { filePath: '/test/file2.ts', relevance: 0.7, tokenCount: 2000 },
            ],
          },
        },
      ]);

      const result = await executeStepContextOptimization(
        mockGenerateContentFn,
        [
          {
            type: 'user',
            functionResponses: [
              {
                name: 'getSourceCode',
                content: JSON.stringify(getSourceCodeTree(mockSourceCode)),
              },
            ],
          },
        ],
        mockOptions,
      );

      expect(result).toBe(StepResult.CONTINUE);
      // Verify that only the first file was included due to token limit
      expect(putSystemMessage).toHaveBeenCalledWith(
        'Context optimization in progress.',
        expect.arrayContaining(['/test/file1.ts']),
      );
    });
  });
});
