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
  estimateTokenCount: vi.fn((content: string) => {
    // Simple mock implementation that returns length of content as token count
    return content ? content.length : 0;
  }),
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
  const mockGenerateContentFn = vi.fn();
  const mockOptions: CodegenOptions = {
    aiService: 'vertex-ai',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateContentFn.mockReset();
  });

  describe('Source code tree transformation', () => {
    it('should correctly transform source code between flat and tree structures', async () => {
      // Mock source code data
      const mockSourceCode = {
        '/test/file1.ts': { content: 'content1' + Array.from(Array(10000).keys()).join(',') },
        '/test/file2.ts': { content: 'content2' },
      };

      const mockSourceCodeTree: SourceCodeTree = {
        '/test': {
          'file1.ts': ['content1' + Array.from(Array(10000).keys()).join(',')],
          'file2.ts': ['content2'],
        },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);
      vi.mocked(getSourceCodeTree).mockReturnValue(mockSourceCodeTree);
      vi.mocked(parseSourceCodeTree).mockReturnValue(mockSourceCode);

      // Mock optimization response with high relevance scores
      mockGenerateContentFn.mockResolvedValueOnce([
        {
          name: 'optimizeContext',
          args: {
            userPrompt: 'test prompt',
            optimizedContext: [
              { filePath: '/test/file1.ts', relevance: 0.9 },
              { filePath: '/test/file2.ts', relevance: 0.8 },
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
      expect(getSourceCodeTree).toHaveBeenCalledWith(expect.any(Object));
      expect(parseSourceCodeTree).toHaveBeenCalledWith(mockSourceCodeTree);
      expect(putSystemMessage).toHaveBeenCalledWith(
        'Context optimization in progress.',
        expect.arrayContaining([
          ['/test/file1.ts', 0.9],
          ['/test/file2.ts', 0.8],
        ]),
      );
    });

    it('should handle empty source code tree', async () => {
      const emptySourceCode = {};
      const emptySourceCodeTree = {};

      vi.mocked(getSourceCode).mockReturnValue(emptySourceCode);
      vi.mocked(getSourceCodeTree).mockReturnValue(emptySourceCodeTree);
      vi.mocked(parseSourceCodeTree).mockReturnValue(emptySourceCode);

      mockGenerateContentFn.mockResolvedValueOnce([
        {
          name: 'optimizeContext',
          args: {
            userPrompt: 'test prompt',
            optimizedContext: [],
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
                content: JSON.stringify(emptySourceCodeTree),
              },
            ],
          },
        ],
        mockOptions,
      );

      expect(result).toBe(StepResult.CONTINUE);
      expect(putSystemMessage).toHaveBeenCalledWith(
        'Context optimization is not needed, because the code base is small.',
      );
    });
  });

  describe('Context optimization process', () => {
    it('should optimize context based on relevance scores', async () => {
      const mockSourceCode = {
        '/test/high-relevance.ts': { content: 'important content' + Array.from(Array(10000).keys()).join(',') },
        '/test/medium-relevance.ts': { content: 'somewhat important' },
        '/test/low-relevance.ts': { content: 'not important' },
      };

      const mockSourceCodeTree: SourceCodeTree = {
        '/test': {
          'high-relevance.ts': ['important content'],
          'medium-relevance.ts': ['somewhat important'],
          'low-relevance.ts': ['not important'],
        },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);
      vi.mocked(getSourceCodeTree).mockReturnValue(mockSourceCodeTree);
      vi.mocked(parseSourceCodeTree).mockReturnValue(mockSourceCode);

      mockGenerateContentFn.mockResolvedValueOnce([
        {
          name: 'optimizeContext',
          args: {
            userPrompt: 'test prompt',
            optimizedContext: [
              { filePath: '/test/high-relevance.ts', relevance: 0.9 },
              { filePath: '/test/medium-relevance.ts', relevance: 0.6 },
              { filePath: '/test/low-relevance.ts', relevance: 0.2 },
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
      expect(putSystemMessage).toHaveBeenCalledWith(
        'Context optimization in progress.',
        expect.arrayContaining([
          ['/test/high-relevance.ts', 0.9],
          ['/test/medium-relevance.ts', 0.6],
        ]),
      );
      // Low relevance file should not be included
      expect(putSystemMessage).not.toHaveBeenCalledWith(
        'Context optimization in progress.',
        expect.arrayContaining(['/test/low-relevance.ts', 0.2]),
      );
    });

    it('should handle optimization failure gracefully', async () => {
      const mockSourceCode = {
        '/test/file.ts': { content: 'test content'.repeat(1000) }, // Make it large enough to trigger optimization
      };

      const mockSourceCodeTree: SourceCodeTree = {
        '/test': {
          'file.ts': ['test content'.repeat(1000)],
        },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);
      vi.mocked(getSourceCodeTree).mockReturnValue(mockSourceCodeTree);
      vi.mocked(parseSourceCodeTree).mockReturnValue(mockSourceCode);

      mockGenerateContentFn.mockResolvedValueOnce([
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
                content: JSON.stringify(mockSourceCodeTree),
              },
            ],
          },
        ],
        mockOptions,
      );

      expect(result).toBe(StepResult.CONTINUE);
      expect(putSystemMessage).toHaveBeenCalledWith(
        'Warning: Context optimization failed to produce useful summaries for all batches. Proceeding with current context.',
      );
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle missing source code response', async () => {
      const result = await executeStepContextOptimization(
        mockGenerateContentFn,
        [], // Empty prompt array
        mockOptions,
      );

      expect(result).toBe(StepResult.CONTINUE);
      expect(putSystemMessage).not.toHaveBeenCalledWith('Context optimization in progress.');
    });

    it('should handle invalid JSON in source code response', async () => {
      await expect(
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
      ).rejects.toThrow('Unexpected token');
    });

    it('should handle errors during optimization process', async () => {
      vi.mocked(getSourceCode).mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      await expect(
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
      ).rejects.toThrow('Unexpected error');
    });
  });

  describe('Token count handling', () => {
    it('should respect MAX_TOTAL_TOKENS limit', async () => {
      // Create source code that exceeds token limit
      const largeContent = 'a'.repeat(12000); // Exceeds MAX_TOTAL_TOKENS (10000)
      const smallContent = 'b'.repeat(3000);

      const mockSourceCode = {
        '/test/large-file.ts': { content: largeContent },
        '/test/small-file.ts': { content: smallContent },
      };

      const mockSourceCodeTree: SourceCodeTree = {
        '/test': {
          'large-file.ts': [largeContent],
          'small-file.ts': [smallContent],
        },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);
      vi.mocked(getSourceCodeTree).mockReturnValue(mockSourceCodeTree);
      vi.mocked(parseSourceCodeTree).mockReturnValue(mockSourceCode);

      mockGenerateContentFn.mockResolvedValueOnce([
        {
          name: 'optimizeContext',
          args: {
            userPrompt: 'test prompt',
            optimizedContext: [
              { filePath: '/test/large-file.ts', relevance: 0.9 },
              { filePath: '/test/small-file.ts', relevance: 0.8 },
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
      expect(putSystemMessage).toHaveBeenCalledWith(
        'Context optimization completed successfully.',
        expect.objectContaining({
          tokensBefore: expect.any(Number),
          tokensAfter: expect.any(Number),
          contentTokenCount: expect.any(Number),
          summaryTokenCount: expect.any(Number),
          percentageReduced: expect.stringContaining('%'),
        }),
      );
    });
  });
});
