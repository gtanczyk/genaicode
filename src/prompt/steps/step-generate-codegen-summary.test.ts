import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCodegenSummary } from './step-generate-codegen-summary.js';
import { PromptItem } from '../../ai-service/common-types.js';
import { FunctionCall } from '../../ai-service/common-types.js';
import { FunctionDef } from '../../ai-service/common-types.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { getSourceCode } from '../../files/read-files.js';

vi.mock('../../files/find-files.js', () => ({
  refreshFiles: vi.fn(),
}));
vi.mock('../../files/read-files.js', () => ({
  getSourceCode: vi.fn(),
}));
vi.mock('../../main/config.js', () => ({
  rootDir: '/test',
  rcConfig: {
    rootDir: '/test',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
  },
  importantContext: {},
}));

describe('generateCodegenSummary', () => {
  const mockGenerateContentFn = vi.fn();

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

  const mockOptions: CodegenOptions = {
    aiService: 'vertex-ai',
    temperature: 0.7,
    askQuestion: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSourceCode).mockReturnValue({});
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

    mockGenerateContentFn.mockResolvedValueOnce([mockCodegenSummary]);

    const result = await generateCodegenSummary(mockGenerateContentFn, mockPrompt, mockFunctionDefs, mockOptions);

    expect(result.codegenSummaryRequest).toEqual(mockCodegenSummary);
    expect(result.baseResult).toHaveLength(1);
    expect(mockGenerateContentFn).toHaveBeenCalledTimes(1);
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

    const result = await generateCodegenSummary(mockGenerateContentFn, mockPrompt, mockFunctionDefs, mockOptions);

    expect(result.codegenSummaryRequest).toEqual(validCodegenSummary);
    expect(mockGenerateContentFn).toHaveBeenCalledTimes(2);
  });

  it('should handle errors in generate content function', async () => {
    mockGenerateContentFn.mockRejectedValueOnce(new Error('Test error'));

    await expect(
      generateCodegenSummary(mockGenerateContentFn, mockPrompt, mockFunctionDefs, mockOptions),
    ).rejects.toThrow('Test error');
  });

  it('should handle no codegen summary in response', async () => {
    mockGenerateContentFn
      .mockResolvedValueOnce([
        {
          name: 'explanation',
          args: { text: 'No changes needed' },
        },
      ])
      .mockResolvedValueOnce([
        {
          name: 'explanation',
          args: { text: 'No changes needed' },
        },
      ])
      .mockResolvedValueOnce([
        {
          name: 'explanation',
          args: { text: 'No changes needed' },
        },
      ]);

    await expect(
      generateCodegenSummary(mockGenerateContentFn, mockPrompt, mockFunctionDefs, mockOptions),
    ).rejects.toThrow('Recovery failed');
  });

  it('should add response to prompt history', async () => {
    const mockCodegenSummary: FunctionCall = {
      name: 'codegenSummary',
      args: {
        explanation: 'Test explanation',
        fileUpdates: [],
        contextPaths: [],
      },
    };

    mockGenerateContentFn.mockResolvedValueOnce([mockCodegenSummary]);

    const prompt: PromptItem[] = [{ type: 'user', text: 'test prompt' }];
    await generateCodegenSummary(mockGenerateContentFn, prompt, mockFunctionDefs, mockOptions);

    expect(prompt).toHaveLength(3); // original + assistant + user response
    expect(prompt[1].type).toBe('assistant');
    expect(prompt[2].type).toBe('user');
  });
});
