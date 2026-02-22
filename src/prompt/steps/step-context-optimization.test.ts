import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeStepContextOptimization } from './step-context-optimization';
import { getSourceCode } from '../../files/read-files';
import { FileContent, FileId, SourceCodeMap } from '../../files/source-code-types';
import { StepResult } from './steps-types';
import { CodegenOptions } from '../../main/codegen-types';
import { putSystemMessage } from '../../main/common/content-bus';
import '../../main/config.js';
import '../../files/find-files.js';
import { PromptItem } from '../../ai-service/common-types';

// Mock dependencies
vi.mock('../../files/read-files');
vi.mock('../../files/find-files.js', () => ({
  getSourceFiles: () => [],
  getImageAssetFiles: () => [],
  refreshFiles: () => null,
}));
vi.mock('../../main/common/content-bus');
vi.mock('../token-estimator', () => ({
  estimateTokenCount: vi.fn((content: string | null | undefined) => {
    // Simple mock implementation that returns length of content as token count
    return content ? content.length : 0;
  }),
}));
vi.mock('./step-summarization', () => ({
  getSummary: vi.fn().mockReturnValue({ summary: 'Test summary', dependencies: [{ path: 'test-dep', type: 'local' }] }),
}));
vi.mock('../../main/config.js', () => ({
  rootDir: '/test',
  rcConfig: {
    rootDir: '/test',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
  },
  importantContext: { files: [] }, // Initialize with empty important files
  sourceExtensions: ['.ts'],
  modelOverrides: {},
}));

const FILE_ID = 1 as FileId;

describe('executeStepContextOptimization', () => {
  const mockGenerateContentFn = vi.fn();
  const mockOptions: CodegenOptions = {
    aiService: 'vertex-ai',
    askQuestion: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateContentFn.mockReset();
  });

  describe('Source code tree transformation', () => {
    it('should correctly transform source code between flat and tree structures', async () => {
      // Mock source code data
      const mockSourceCode: SourceCodeMap = {
        '/test/file1.ts': { fileId: FILE_ID, content: 'content1' + Array.from(Array(10000).keys()).join(',') },
        '/test/file2.ts': { fileId: FILE_ID, content: 'content2' },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);

      // Mock optimization response with high relevance scores
      mockGenerateContentFn.mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            name: 'optimizeContext',
            args: {
              userPrompt: 'test prompt',
              reasoning: 'test reasoning',
              optimizedContext: [
                { reasoning: 'test reasoning', filePath: '/test/file1.ts', relevance: 0.9 },
                { reasoning: 'test reasoning', filePath: '/test/file2.ts', relevance: 0.8 },
              ],
            },
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
                content: JSON.stringify(mockSourceCode),
              },
            ],
          },
        ],
        mockOptions,
      );

      expect(result).toBe(StepResult.CONTINUE);
      expect(putSystemMessage).toHaveBeenCalledWith('Context optimization is starting for large codebase');
      expect(putSystemMessage).toHaveBeenCalledWith(
        'Context optimization completed successfully.',
        expect.objectContaining({
          optimizedContext: [
            ['/test/file1.ts', 0.9],
            ['/test/file2.ts', 0.8],
          ],
        }),
      );
    });

    it('should handle empty source code tree', async () => {
      const emptySourceCode = {};

      vi.mocked(getSourceCode).mockReturnValue(emptySourceCode);

      // Optimization should not be called for small codebase

      const result = await executeStepContextOptimization(
        mockGenerateContentFn,
        [
          {
            type: 'user',
            functionResponses: [
              {
                name: 'getSourceCode',
                content: JSON.stringify(emptySourceCode),
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
      expect(mockGenerateContentFn).not.toHaveBeenCalled();
    });
  });

  describe('Multiple getSourceCode responses handling', () => {
    // This test verifies that when clearing previous getSourceCode responses:
    // 1. Directory structure is preserved
    // 2. File content is set to null for non-optimized files
    // 3. The overall structure of the conversation remains intact
    it('should clear previous getSourceCode responses while preserving structure', async () => {
      const mockSourceCode: SourceCodeMap = {
        '/test/file1.ts': { fileId: FILE_ID, content: 'content1' + Array.from(Array(10000).keys()).join(',') },
      };
      const oldSourceCode = { '/test/old-file.ts': { fileId: 1234 as FileId, content: 'old content' } };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);

      mockGenerateContentFn.mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            name: 'optimizeContext',
            args: {
              userPrompt: 'test prompt',
              reasoning: 'test reasoning',
              optimizedContext: [{ reasoning: 'test reasoning', filePath: '/test/file1.ts', relevance: 0.9 }],
            },
          },
        },
      ]);

      const prompt: PromptItem[] = [
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify(oldSourceCode),
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
              content: JSON.stringify(mockSourceCode),
            },
          ],
        },
      ];

      const result = await executeStepContextOptimization(mockGenerateContentFn, prompt, mockOptions);

      expect(result).toBe(StepResult.CONTINUE);

      // Verify that previous responses maintain structure but clear content for irrelevant files
      const expectedStructure = {
        '/test/old-file.ts': { fileId: 1234 as FileId, content: null }, // Content cleared as it's irrelevant
      };
      expect(JSON.parse(prompt[0].functionResponses![0].content!)).toEqual(expectedStructure);

      // Verify that structure was preserved
      expect(prompt[0].type).toBe('user');
      expect(prompt[0].functionResponses![0].name).toBe('getSourceCode');
      // Verify that non-getSourceCode items were preserved
      expect(prompt[1].type).toBe('assistant');
      expect(prompt[1].text).toBe('Some response');
    });

    // This test verifies that when handling multiple responses:
    // 1. Each response maintains its directory structure
    // 2. Content is cleared (set to null) for all previous responses' irrelevant files
    // 3. The latest response remains unchanged until after optimization
    it('should handle multiple responses with different content', async () => {
      const mockSourceCode: SourceCodeMap = {
        '/test/file1.ts': { fileId: FILE_ID, content: 'content1' + Array.from(Array(10000).keys()).join(',') },
        '/test/file2.ts': { fileId: FILE_ID, content: 'content2' },
      };
      const oldSourceCode1 = { '/test/file1.ts': { fileId: FILE_ID, content: 'old content 1' } };
      const oldSourceCode2 = { '/test/file2.ts': { fileId: FILE_ID, content: 'old content 2' } };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);

      mockGenerateContentFn.mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            name: 'optimizeContext',
            args: {
              userPrompt: 'test prompt',
              reasoning: 'test reasoning',
              optimizedContext: [
                { reasoning: 'test reasoning', filePath: '/test/file1.ts', relevance: 0.9 },
                // file2.ts is considered irrelevant (relevance < 0.5)
              ],
            },
          },
        },
      ]);

      const prompt: PromptItem[] = [
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify(oldSourceCode1),
            },
          ],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify(oldSourceCode2),
            },
          ],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify(mockSourceCode),
            },
          ],
        },
      ];

      const result = await executeStepContextOptimization(mockGenerateContentFn, prompt, mockOptions);

      expect(result).toBe(StepResult.CONTINUE);
      // Verify that previous responses maintain structure but clear content
      prompt.slice(0, -1).forEach((item) => {
        if (item.type === 'user' && item.functionResponses) {
          const response = item.functionResponses.find((r) => r.name === 'getSourceCode');
          const parsedContent = JSON.parse(response!.content!);
          // Check that structure is preserved but content is null
          expect(Object.keys(parsedContent)[0]).toEqual(expect.stringContaining('/test/file'));
          Object.values(parsedContent).forEach((file) => {
            expect((file as FileContent).content).toBe(null);
          });
        }
      });
    });

    it('should handle edge case with no getSourceCode responses', async () => {
      const mockSourceCode = {
        '/test/file1.ts': { fileId: FILE_ID, content: 'content1' + Array.from(Array(10000).keys()).join(',') },
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

      // Optimization should not run if no source code response is found
      const result = await executeStepContextOptimization(mockGenerateContentFn, prompt, mockOptions);

      expect(result).toBe(StepResult.CONTINUE);
      expect(putSystemMessage).toHaveBeenCalledWith(
        'Could not find source code response, something is wrong, but lets continue anyway.',
      );
      expect(mockGenerateContentFn).not.toHaveBeenCalled();
      // Verify that the prompt structure remains unchanged
      expect(prompt).toHaveLength(2);
      expect(prompt[0].type).toBe('user');
      expect(prompt[0].text).toBe('Some user message');
      expect(prompt[1].type).toBe('assistant');
      expect(prompt[1].text).toBe('Some assistant response');
    });

    it('should handle edge case with empty functionResponses', async () => {
      const mockSourceCode = {
        '/test/file1.ts': { fileId: FILE_ID, content: 'content1' + Array.from(Array(10000).keys()).join(',') },
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
      // Optimization should not run if no source code response is found
      const result = await executeStepContextOptimization(mockGenerateContentFn, prompt, mockOptions);

      expect(result).toBe(StepResult.CONTINUE);
      expect(putSystemMessage).toHaveBeenCalledWith(
        'Could not find source code response, something is wrong, but lets continue anyway.',
      );
      expect(mockGenerateContentFn).not.toHaveBeenCalled();
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
      const mockSourceCode: SourceCodeMap = {
        '/test/high-relevance.ts': {
          fileId: FILE_ID,
          content: 'important content' + Array.from(Array(10000).keys()).join(','),
        },
        '/test/medium-relevance.ts': { fileId: FILE_ID, content: 'somewhat important' },
        '/test/low-relevance.ts': { fileId: FILE_ID, content: 'not important' },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);

      mockGenerateContentFn.mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            name: 'optimizeContext',
            args: {
              userPrompt: 'test prompt',
              reasoning: 'test reasoning',
              optimizedContext: [
                { reasoning: 'test reasoning', filePath: '/test/high-relevance.ts', relevance: 0.9 },
                { reasoning: 'test reasoning', filePath: '/test/medium-relevance.ts', relevance: 0.6 },
                { reasoning: 'test reasoning', filePath: '/test/low-relevance.ts', relevance: 0.2 }, // Below threshold
              ],
            },
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
                content: JSON.stringify(mockSourceCode),
              },
            ],
          },
        ],
        mockOptions,
      );

      expect(result).toBe(StepResult.CONTINUE);
      expect(putSystemMessage).toHaveBeenCalledWith('Context optimization is starting for large codebase');
      expect(putSystemMessage).toHaveBeenCalledWith(
        'Context optimization completed successfully.',
        expect.objectContaining({
          optimizedContext: [
            ['/test/high-relevance.ts', 0.9],
            ['/test/medium-relevance.ts', 0.6],
          ],
        }),
      );
      // Low relevance file should not be included
      expect(putSystemMessage).not.toHaveBeenCalledWith(
        'Context optimization completed successfully.',
        expect.objectContaining({
          optimizedContext: expect.arrayContaining(['/test/low-relevance.ts', 0.2]),
        }),
      );
    });

    it('should handle optimization failure gracefully (empty optimizedContext)', async () => {
      const mockSourceCode: SourceCodeMap = {
        '/test/file.ts': { fileId: FILE_ID, content: 'test content'.repeat(1000) }, // Make it large enough to trigger optimization
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);

      mockGenerateContentFn.mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            name: 'optimizeContext',
            args: {
              userPrompt: 'test prompt',
              reasoning: 'test reasoning',
              optimizedContext: [], // Empty context indicates optimization failure or no relevant files >= 0.5
            },
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
                content: JSON.stringify(mockSourceCode),
              },
            ],
          },
        ],
        mockOptions,
      );

      expect(result).toBe(StepResult.CONTINUE);
      expect(putSystemMessage).toHaveBeenCalledWith('Context optimization is starting for large codebase');
      expect(putSystemMessage).toHaveBeenCalledWith(
        'Context optimization did not generate changes to current context.',
      );
    });
  });

  describe('Edge cases and error handling', () => {
    beforeEach(() => {
      const mockSourceCode: SourceCodeMap = {
        '/test/file1.ts': { fileId: FILE_ID, content: 'content1' + Array.from(Array(10000).keys()).join(',') },
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
      expect(putSystemMessage).toHaveBeenCalledWith(
        'Could not find source code response, something is wrong, but lets continue anyway.',
      );
      expect(mockGenerateContentFn).not.toHaveBeenCalled();
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

    it('should handle errors during generateContent call', async () => {
      vi.mocked(getSourceCode).mockReturnValue({
        '/test/file1.ts': { fileId: FILE_ID, content: 'content1' + Array.from(Array(10000).keys()).join(',') },
      });
      mockGenerateContentFn.mockRejectedValueOnce(new Error('AI Service Error'));

      const result = await executeStepContextOptimization(
        mockGenerateContentFn,
        [
          {
            type: 'user',
            functionResponses: [
              {
                name: 'getSourceCode',
                content: JSON.stringify({ '/test/file1.ts': { fileId: FILE_ID, content: 'content1' } }),
              },
            ],
          },
        ],
        mockOptions,
      );

      expect(result).toBe(StepResult.BREAK);
      expect(putSystemMessage).toHaveBeenCalledWith('Context optimization is starting for large codebase');
      expect(putSystemMessage).toHaveBeenCalledWith('Error: Context optimization failed. This is unexpected.');
    });
  });

  describe('Token count handling', () => {
    it('should respect MAX_TOTAL_TOKENS limit', async () => {
      // Create source code that exceeds token limit
      const largeContent = 'a'.repeat(12000); // Exceeds MAX_TOTAL_TOKENS (10000)
      const smallContent = 'b'.repeat(3000);

      const mockSourceCode: SourceCodeMap = {
        '/test/large-file.ts': { fileId: FILE_ID, content: largeContent },
        '/test/small-file.ts': { fileId: FILE_ID, content: smallContent },
      };

      vi.mocked(getSourceCode).mockReturnValue(mockSourceCode);

      mockGenerateContentFn.mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            name: 'optimizeContext',
            args: {
              userPrompt: 'test prompt',
              reasoning: 'test reasoning',
              optimizedContext: [
                // Assume large file is just below the 0.7 threshold but pushes total over limit
                { reasoning: 'test reasoning', filePath: '/test/large-file.ts', relevance: 0.65 },
                { reasoning: 'test reasoning', filePath: '/test/small-file.ts', relevance: 0.9 }, // Highly relevant
              ],
            },
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
                content: JSON.stringify(mockSourceCode),
              },
            ],
          },
        ],
        mockOptions,
      );

      expect(result).toBe(StepResult.CONTINUE);
      expect(putSystemMessage).toHaveBeenCalledWith('Context optimization is starting for large codebase');
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
