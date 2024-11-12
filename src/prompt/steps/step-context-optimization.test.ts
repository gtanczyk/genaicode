import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeStepContextOptimization } from './step-context-optimization';
import { getSourceCode } from '../../files/read-files';
import { SourceCodeTree } from '../../files/source-code-tree';
import { StepResult } from './steps-types';
import { CodegenOptions } from '../../main/codegen-types';
import { putSystemMessage } from '../../main/common/content-bus';
import '../../main/config.js';
import '../../files/find-files.js';
import { PromptItem } from '../../ai-service/common';

// Mock dependencies
vi.mock('../../files/read-files');
vi.mock('../../files/find-files.js', () => ({
  getSourceFiles: () => [],
  getImageAssetFiles: () => [],
  refreshFiles: () => null,
}));
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
          'file1.ts': { content: 'content1' + Array.from(Array(10000).keys()).join(',') },
          'file2.ts': { content: 'content2' },
        },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);

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

  describe('Multiple getSourceCode responses handling', () => {
    it('should clear previous getSourceCode responses while preserving structure', async () => {
      const mockSourceCode = {
        '/test/file1.ts': { content: 'content1' + Array.from(Array(10000).keys()).join(',') },
      };

      const mockSourceCodeTree: SourceCodeTree = {
        '/test': {
          'file1.ts': { content: 'content1' + Array.from(Array(10000).keys()).join(',') },
        },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);

      mockGenerateContentFn.mockResolvedValueOnce([
        {
          name: 'optimizeContext',
          args: {
            userPrompt: 'test prompt',
            optimizedContext: [{ filePath: '/test/file1.ts', relevance: 0.9 }],
          },
        },
      ]);

      const prompt: PromptItem[] = [
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify({ '/test': { 'old-file.ts': { content: 'old content' } } }),
            },
          ],
        },
        {
          type: 'assistant',
          text: 'Some response',
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify(mockSourceCodeTree),
            },
          ],
        },
      ];

      const result = await executeStepContextOptimization(mockGenerateContentFn, prompt, mockOptions);

      expect(result).toBe(StepResult.CONTINUE);

      // Verify that previous responses were cleared
      expect(JSON.parse(prompt[0].functionResponses![0].content!)).toEqual({});
      // Verify that structure was preserved
      expect(prompt[0].type).toBe('user');
      expect(prompt[0].functionResponses![0].name).toBe('getSourceCode');
      // Verify that non-getSourceCode items were preserved
      expect(prompt[1].type).toBe('assistant');
      expect(prompt[1].text).toBe('Some response');
    });

    it('should handle multiple responses with different content', async () => {
      const mockSourceCode = {
        '/test/file1.ts': { content: 'content1' + Array.from(Array(10000).keys()).join(',') },
        '/test/file2.ts': { content: 'content2' },
      };

      const mockSourceCodeTree: SourceCodeTree = {
        '/test': {
          'file1.ts': { content: 'content1' + Array.from(Array(10000).keys()).join(',') },
          'file2.ts': { content: 'content2' },
        },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);

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

      const prompt: PromptItem[] = [
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify({ '/test': { 'file1.ts': { content: 'old content 1' } } }),
            },
          ],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify({ '/test': { 'file2.ts': { content: 'old content 2' } } }),
            },
          ],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify(mockSourceCodeTree),
            },
          ],
        },
      ];

      const result = await executeStepContextOptimization(mockGenerateContentFn, prompt, mockOptions);

      expect(result).toBe(StepResult.CONTINUE);
      // Verify that all previous responses were cleared
      prompt.slice(0, -1).forEach((item) => {
        if (item.type === 'user' && item.functionResponses) {
          const response = item.functionResponses.find((r) => r.name === 'getSourceCode');
          expect(JSON.parse(response!.content!)).toEqual({});
        }
      });
    });

    it('should handle edge case with no getSourceCode responses', async () => {
      const mockSourceCode = {
        '/test/file1.ts': { content: 'content1' + Array.from(Array(10000).keys()).join(',') },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);

      const prompt: PromptItem[] = [
        {
          type: 'user',
          text: 'Some user message',
        },
        {
          type: 'assistant',
          text: 'Some assistant response',
        },
      ];

      const result = await executeStepContextOptimization(mockGenerateContentFn, prompt, mockOptions);

      expect(result).toBe(StepResult.CONTINUE);
      // Verify that the prompt structure remains unchanged
      expect(prompt).toHaveLength(2);
      expect(prompt[0].type).toBe('user');
      expect(prompt[0].text).toBe('Some user message');
      expect(prompt[1].type).toBe('assistant');
      expect(prompt[1].text).toBe('Some assistant response');
    });

    it('should handle edge case with empty functionResponses', async () => {
      const mockSourceCode = {
        '/test/file1.ts': { content: 'content1' + Array.from(Array(10000).keys()).join(',') },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);

      const prompt: PromptItem[] = [
        {
          type: 'user',
          functionResponses: [],
        },
        {
          type: 'user',
          functionResponses: undefined,
        },
      ];

      const result = await executeStepContextOptimization(mockGenerateContentFn, prompt, mockOptions);

      expect(result).toBe(StepResult.CONTINUE);
      // Verify that the prompt structure remains unchanged
      expect(prompt).toHaveLength(2);
      expect(prompt[0].type).toBe('user');
      expect(prompt[0].functionResponses).toEqual([]);
      expect(prompt[1].type).toBe('user');
      expect(prompt[1].functionResponses).toBeUndefined();
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
          'high-relevance.ts': { content: 'important content' },
          'medium-relevance.ts': { content: 'somewhat important' },
          'low-relevance.ts': { content: 'not important' },
        },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);

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
          'file.ts': { content: 'test content'.repeat(1000) },
        },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);

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
    beforeEach(() => {
      const mockSourceCode = {
        '/test/file1.ts': { content: 'content1' + Array.from(Array(10000).keys()).join(',') },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);
    });

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
          'large-file.ts': { content: largeContent },
          'small-file.ts': { content: smallContent },
        },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);

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