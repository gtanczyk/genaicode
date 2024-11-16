import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeStepCodegenSummary } from './step-codegen-summary.js';
import { FunctionCall, PromptItem, FunctionDef } from '../../ai-service/common.js';
import { CodegenOptions } from '../../main/codegen-types.js';

vi.mock('../../files/find-files.js', () => ({
  refreshFiles: vi.fn(),
}));

vi.mock('../../main/config.js', () => ({
  rootDir: '/test',
  rcConfig: {
    rootDir: '/test',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
  },
  importantContext: {},
}));

describe('executeStepCodegenSummary', () => {
  const mockGenerateContentFn = vi.fn();
  const mockWaitIfPaused = vi.fn();

  // Mock data
  const mockPrompt: PromptItem[] = [{ type: 'user', text: 'test prompt' }];
  const mockFunctionDefs: FunctionDef[] = [
    {
      name: 'codegenSummary',
      description: 'Function for generating codegen summary',
      parameters: {
        type: 'object',
        properties: {
          explanation: { type: 'string', description: 'Explanation of changes' },
          fileUpdates: { type: 'array', description: 'List of file updates' },
          contextPaths: { type: 'array', description: 'List of context paths' },
        },
        required: ['explanation', 'fileUpdates', 'contextPaths'],
      },
    },
  ];
  // const mockGetSourceCodeRequest: FunctionCall = { name: 'getSourceCode' };
  // const mockGetSourceCodeResponse: PromptItem = {
  //   type: 'user',
  //   functionResponses: [{ name: 'getSourceCode', content: '{}' }],
  // };
  // const mockMessages = {
  //   contextSourceCode: (paths: string[]) => JSON.stringify({ paths }),
  // };
  const mockOptions: CodegenOptions = {
    aiService: 'vertex-ai',
    temperature: 0.7,
    askQuestion: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWaitIfPaused.mockResolvedValue(undefined);
  });

  it('should handle successful codegen summary generation', async () => {
    const mockCodegenSummary: FunctionCall = {
      name: 'codegenSummary',
      args: {
        explanation: 'Test explanation',
        fileUpdates: [
          {
            filePath: '/test/path.ts',
            updateToolName: 'updateFile',
            prompt: 'Update test file',
          },
        ],
        contextPaths: ['/test/context.ts'],
      },
    };

    const mockUpdateResult: FunctionCall = {
      name: 'updateFile',
      args: {
        filePath: '/test/path.ts',
        newContent: 'updated content',
        explanation: 'Updated file',
      },
    };

    mockGenerateContentFn.mockResolvedValueOnce([mockCodegenSummary]).mockResolvedValueOnce([mockUpdateResult]);

    const result = await executeStepCodegenSummary(
      mockGenerateContentFn,
      mockPrompt,
      mockFunctionDefs,
      // mockGetSourceCodeRequest,
      // mockGetSourceCodeResponse,
      // mockMessages,
      mockOptions,
      mockWaitIfPaused,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(mockUpdateResult);
    expect(mockGenerateContentFn).toHaveBeenCalledTimes(2);
  });

  it('should handle validation and recovery of invalid codegen summary', async () => {
    const invalidCodegenSummary: FunctionCall = {
      name: 'codegenSummary',
      args: {
        // Missing required fields
      },
    };

    const validCodegenSummary: FunctionCall = {
      name: 'codegenSummary',
      args: {
        explanation: 'Recovered explanation',
        fileUpdates: [],
        contextPaths: [],
      },
    };

    mockGenerateContentFn.mockResolvedValueOnce([invalidCodegenSummary]).mockResolvedValueOnce([validCodegenSummary]);

    const result = await executeStepCodegenSummary(
      mockGenerateContentFn,
      mockPrompt,
      mockFunctionDefs,
      // mockGetSourceCodeRequest,
      // mockGetSourceCodeResponse,
      // mockMessages,
      mockOptions,
      mockWaitIfPaused,
    );

    expect(result).toHaveLength(0);
    expect(mockGenerateContentFn).toHaveBeenCalledTimes(2);
  });

  it('should handle errors in generate content function', async () => {
    mockGenerateContentFn.mockRejectedValueOnce(new Error('Test error'));

    await expect(
      executeStepCodegenSummary(
        mockGenerateContentFn,
        mockPrompt,
        mockFunctionDefs,
        // mockGetSourceCodeRequest,
        // mockGetSourceCodeResponse,
        // mockMessages,
        mockOptions,
        mockWaitIfPaused,
      ),
    ).rejects.toThrow('Test error');
  });

  it('should handle no codegen summary in response', async () => {
    mockGenerateContentFn.mockResolvedValueOnce([
      {
        name: 'explanation',
        args: { text: 'No changes needed' },
      },
    ]);

    const result = await executeStepCodegenSummary(
      mockGenerateContentFn,
      mockPrompt,
      mockFunctionDefs,
      // mockGetSourceCodeRequest,
      // mockGetSourceCodeResponse,
      // mockMessages,
      mockOptions,
      mockWaitIfPaused,
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('explanation');
  });

  it('should respect waitIfPaused during file updates', async () => {
    const mockCodegenSummary: FunctionCall = {
      name: 'codegenSummary',
      args: {
        explanation: 'Test pause handling',
        fileUpdates: [
          { filePath: '/test/file1.ts', updateToolName: 'updateFile', prompt: 'Update 1' },
          { filePath: '/test/file2.ts', updateToolName: 'updateFile', prompt: 'Update 2' },
        ],
        contextPaths: [],
      },
    };

    mockGenerateContentFn
      .mockResolvedValueOnce([mockCodegenSummary])
      .mockResolvedValueOnce([
        { name: 'updateFile', args: { filePath: '/test/file1.ts', newContent: 'test', explanation: 'test' } },
      ])
      .mockResolvedValueOnce([
        { name: 'updateFile', args: { filePath: '/test/file2.ts', newContent: 'test', explanation: 'test' } },
      ]);

    await executeStepCodegenSummary(
      mockGenerateContentFn,
      mockPrompt,
      mockFunctionDefs,
      // mockGetSourceCodeRequest,
      // mockGetSourceCodeResponse,
      // mockMessages,
      mockOptions,
      mockWaitIfPaused,
    );

    expect(mockWaitIfPaused).toHaveBeenCalledTimes(2);
  });
});
