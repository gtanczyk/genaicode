import { describe, it, expect, vi, beforeEach } from 'vitest';
import { internalGenerateContent } from './openai.js';
import OpenAI from 'openai';
import { ModelType } from './common-types.js';

// Mock dependencies
vi.mock('./common.js', () => ({
  optimizeFunctionDefs: vi.fn().mockReturnValue([]),
  printTokenUsageAndCost: vi.fn(),
}));
vi.mock('./service-configurations.js', () => ({
  getServiceConfig: vi.fn().mockReturnValue({ apiKey: 'test-key' }),
  getModelSettings: vi.fn().mockReturnValue({}),
}));
vi.mock('../main/common/abort-controller.js', () => ({
  abortController: undefined,
}));

describe('internalGenerateContent - code execution', () => {
  let mockOpenAI: OpenAI;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    mockCreate = vi.fn();
    mockOpenAI = {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    } as unknown as OpenAI;
  });

  it('should use code_execution tool type for all service types', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'test response', tool_calls: null } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    await internalGenerateContent(
      [{ type: 'user', text: 'test' }],
      {
        expectedResponseType: { text: true, codeExecution: true, functionCall: false },
      },
      'test-model',
      mockOpenAI,
      'github-models',
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.tools).toBeDefined();
    const codeTool = callArgs.tools.find((t: { type: string }) => t.type === 'code_execution');
    expect(codeTool).toBeDefined();
    expect(codeTool.type).toBe('code_execution');
  });

  it('should attach file_ids to code_execution tool when provided', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'test response', tool_calls: null } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const fileIds = ['file-123', 'file-456'];
    await internalGenerateContent(
      [{ type: 'user', text: 'test' }],
      {
        expectedResponseType: { text: true, codeExecution: true, functionCall: false },
        fileIds,
      },
      'test-model',
      mockOpenAI,
      'github-models',
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    const codeTool = callArgs.tools.find((t: { type: string }) => t.type === 'code_execution');
    expect(codeTool).toBeDefined();
    expect(codeTool.code_execution).toEqual({ file_ids: fileIds });
  });

  it('should attach file_ids for plugin service types', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'test response', tool_calls: null } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const fileIds = ['file-789'];
    await internalGenerateContent(
      [{ type: 'user', text: 'test' }],
      {
        expectedResponseType: { text: true, codeExecution: true, functionCall: false },
        fileIds,
      },
      'test-model',
      mockOpenAI,
      'plugin:grok-ai-service' as any,
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    const codeTool = callArgs.tools.find((t: { type: string }) => t.type === 'code_execution');
    expect(codeTool).toBeDefined();
    expect(codeTool.code_execution).toEqual({ file_ids: fileIds });
  });

  it('should parse code_execution tool calls from response', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                type: 'code_execution',
                code_execution: {
                  input: 'print("hello")',
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const result = await internalGenerateContent(
      [{ type: 'user', text: 'test' }],
      {
        expectedResponseType: { text: true, codeExecution: true, functionCall: false },
      },
      'test-model',
      mockOpenAI,
      'github-models',
    );

    const executableCode = result.find((r) => r.type === 'executableCode');
    expect(executableCode).toBeDefined();
    expect(executableCode!.type).toBe('executableCode');
    if (executableCode!.type === 'executableCode') {
      expect(executableCode!.code).toBe('print("hello")');
      expect(executableCode!.language).toBe('python');
    }
  });

  it('should parse code_interpreter tool calls from response', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                type: 'code_interpreter',
                code_interpreter: {
                  input: 'import pandas as pd',
                  outputs: [{ type: 'logs', logs: 'Success' }],
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const result = await internalGenerateContent(
      [{ type: 'user', text: 'test' }],
      {
        expectedResponseType: { text: true, codeExecution: true, functionCall: false },
      },
      'test-model',
      mockOpenAI,
      'github-models',
    );

    const executableCode = result.find((r) => r.type === 'executableCode');
    expect(executableCode).toBeDefined();
    if (executableCode!.type === 'executableCode') {
      expect(executableCode!.code).toBe('import pandas as pd');
    }

    const execResult = result.find((r) => r.type === 'codeExecutionResult');
    expect(execResult).toBeDefined();
    if (execResult!.type === 'codeExecutionResult') {
      expect(execResult!.outcome).toBe('OUTCOME_OK');
      expect(execResult!.output).toContain('Success');
    }
  });

  it('should not attach file_ids when none provided', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'test response', tool_calls: null } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    await internalGenerateContent(
      [{ type: 'user', text: 'test' }],
      {
        expectedResponseType: { text: true, codeExecution: true, functionCall: false },
      },
      'test-model',
      mockOpenAI,
      'github-models',
    );

    const callArgs = mockCreate.mock.calls[0][0];
    const codeTool = callArgs.tools.find((t: { type: string }) => t.type === 'code_execution');
    expect(codeTool).toBeDefined();
    expect(codeTool.code_execution).toBeUndefined();
  });

  it('should override toolChoice none when code execution is requested', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'test response', tool_calls: null } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    await internalGenerateContent(
      [{ type: 'user', text: 'test' }],
      {
        expectedResponseType: { text: true, codeExecution: true, functionCall: false },
      },
      'test-model',
      mockOpenAI,
      'github-models',
    );

    const callArgs = mockCreate.mock.calls[0][0];
    // tool_choice should not be 'none' when code execution is enabled
    expect(callArgs.tool_choice).not.toBe('none');
  });
});
