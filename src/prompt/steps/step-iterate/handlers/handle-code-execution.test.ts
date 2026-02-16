import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionHandlerProps } from '../step-iterate-types.js';
import { CodegenOptions } from '../../../../main/codegen-types.js';
import { GenerateContentResult } from '../../../../ai-service/common-types.js';

// Mocks
vi.mock('../../../../main/common/content-bus.js');
vi.mock('../../../../main/common/user-actions.js');
vi.mock('../../../../ai-service/files-api.js', () => ({
  getFilesApiProvider: vi.fn(),
}));
vi.mock('../../../../main/config.js', () => ({
  rcConfig: { rootDir: '/project' },
}));
vi.mock('../../../../files/path-utils.js', () => ({
  isProjectPath: vi.fn().mockReturnValue(true),
}));

import * as contentBus from '../../../../main/common/content-bus.js';
import * as userActions from '../../../../main/common/user-actions.js';
import * as filesApi from '../../../../ai-service/files-api.js';

const mockPutSystemMessage = vi.mocked(contentBus.putSystemMessage);
const mockPutAssistantMessage = vi.mocked(contentBus.putAssistantMessage);
const mockAskUserForInput = vi.mocked(userActions.askUserForInput);
const mockAskUserForConfirmation = vi.mocked(userActions.askUserForConfirmation);
const mockGetFilesApiProvider = vi.mocked(filesApi.getFilesApiProvider);

// Import handler after mocks are set up
import { handlers } from '../step-iterate-handlers.js';
import './handle-code-execution.js';

const mockGenerateContentFn = vi.fn();
const mockGenerateImageFn = vi.fn();
const mockWaitIfPaused = vi.fn().mockResolvedValue(undefined);

function createProps(overrides: Partial<ActionHandlerProps> = {}): ActionHandlerProps {
  return {
    iterateCall: {
      name: 'iterate',
      args: {
        actionType: 'codeExecution',
        message: 'I will execute some code to analyze the data.',
      },
    },
    prompt: [],
    options: {
      aiService: 'ai-studio',
      askQuestion: true,
      interactive: false,
    } as CodegenOptions,
    generateContentFn: mockGenerateContentFn,
    generateImageFn: mockGenerateImageFn,
    waitIfPaused: mockWaitIfPaused,
    ...overrides,
  };
}

describe('handleCodeExecution', () => {
  let handleCodeExecution: ActionHandlerProps extends never ? never : typeof handlers.codeExecution;

  beforeEach(() => {
    vi.clearAllMocks();
    handleCodeExecution = handlers['codeExecution']!;

    // Default mock: askUserForInput returns empty answer
    mockAskUserForInput.mockResolvedValue({ answer: '' } as ReturnType<typeof userActions.askUserForInput> extends Promise<infer T> ? T : never);
  });

  it('should be registered as a handler', () => {
    expect(handleCodeExecution).toBeDefined();
  });

  it('should pass iterateCall message to generateContentFn as assistant prompt item', async () => {
    const aiResponse: GenerateContentResult = [
      { type: 'text', text: 'Here is the result.' },
    ];
    mockGenerateContentFn.mockResolvedValue(aiResponse);

    const props = createProps();
    await handleCodeExecution!(props);

    expect(mockGenerateContentFn).toHaveBeenCalledTimes(1);
    const [promptArg] = mockGenerateContentFn.mock.calls[0];

    // The prompt should include the iterate message as an assistant item
    const lastItem = promptArg[promptArg.length - 1];
    expect(lastItem).toEqual({
      type: 'assistant',
      text: 'I will execute some code to analyze the data.',
    });
  });

  it('should not mutate the original prompt array', async () => {
    const aiResponse: GenerateContentResult = [
      { type: 'text', text: 'Result text.' },
    ];
    mockGenerateContentFn.mockResolvedValue(aiResponse);

    const originalPrompt = [{ type: 'user' as const, text: 'Hello' }];
    const props = createProps({ prompt: originalPrompt });
    await handleCodeExecution!(props);

    // The original prompt should not be modified
    expect(originalPrompt).toHaveLength(1);
  });

  it('should call generateContentFn with codeExecution enabled and functionCall disabled', async () => {
    const aiResponse: GenerateContentResult = [
      { type: 'text', text: 'Result.' },
    ];
    mockGenerateContentFn.mockResolvedValue(aiResponse);

    const props = createProps();
    await handleCodeExecution!(props);

    const [, configArg] = mockGenerateContentFn.mock.calls[0];
    expect(configArg.expectedResponseType).toEqual({
      text: true,
      codeExecution: true,
      functionCall: false,
    });
  });

  it('should return assistant item with text from AI response', async () => {
    const aiResponse: GenerateContentResult = [
      { type: 'text', text: 'Line 1' },
      { type: 'text', text: 'Line 2' },
    ];
    mockGenerateContentFn.mockResolvedValue(aiResponse);

    const props = createProps();
    const result = await handleCodeExecution!(props);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].assistant.text).toBe('Line 1\nLine 2');
  });

  it('should fall back to iterate message when AI returns no text', async () => {
    const aiResponse: GenerateContentResult = [
      { type: 'executableCode', code: 'print("hello")', language: 'python' },
    ];
    mockGenerateContentFn.mockResolvedValue(aiResponse);

    const props = createProps();
    const result = await handleCodeExecution!(props);

    expect(result.items[0].assistant.text).toBe('I will execute some code to analyze the data.');
  });

  it('should include executableCode in the result', async () => {
    const aiResponse: GenerateContentResult = [
      { type: 'text', text: 'Running code...' },
      { type: 'executableCode', code: 'print("hello")', language: 'python' },
    ];
    mockGenerateContentFn.mockResolvedValue(aiResponse);

    const props = createProps();
    const result = await handleCodeExecution!(props);

    expect(result.items[0].assistant.executableCode).toEqual({
      language: 'python',
      code: 'print("hello")',
    });
  });

  it('should include codeExecutionResult in the result', async () => {
    const aiResponse: GenerateContentResult = [
      { type: 'text', text: 'Code executed.' },
      { type: 'executableCode', code: 'print("hello")', language: 'python' },
      { type: 'codeExecutionResult', outcome: 'OUTCOME_OK', output: 'hello\n' },
    ];
    mockGenerateContentFn.mockResolvedValue(aiResponse);

    const props = createProps();
    const result = await handleCodeExecution!(props);

    expect(result.items[0].assistant.codeExecutionResult).toEqual({
      outcome: 'OUTCOME_OK',
      output: 'hello\n',
      outputFiles: undefined,
    });
  });

  it('should call putAssistantMessage with results', async () => {
    const aiResponse: GenerateContentResult = [
      { type: 'text', text: 'The answer is 42.' },
    ];
    mockGenerateContentFn.mockResolvedValue(aiResponse);

    const props = createProps();
    await handleCodeExecution!(props);

    expect(mockPutAssistantMessage).toHaveBeenCalledWith('The answer is 42.', expect.any(Object));
  });

  it('should ask user for input after displaying results', async () => {
    const aiResponse: GenerateContentResult = [
      { type: 'text', text: 'Result text.' },
    ];
    mockGenerateContentFn.mockResolvedValue(aiResponse);
    mockAskUserForInput.mockResolvedValue({ answer: 'thanks' } as ReturnType<typeof userActions.askUserForInput> extends Promise<infer T> ? T : never);

    const props = createProps();
    const result = await handleCodeExecution!(props);

    expect(mockAskUserForInput).toHaveBeenCalledWith('Your answer', '', props.options);
    expect(result.items[0].user.text).toBe('thanks');
  });

  it('should set breakLoop to false', async () => {
    const aiResponse: GenerateContentResult = [
      { type: 'text', text: 'Done.' },
    ];
    mockGenerateContentFn.mockResolvedValue(aiResponse);

    const props = createProps();
    const result = await handleCodeExecution!(props);

    expect(result.breakLoop).toBe(false);
  });

  it('should handle errors gracefully with try/catch', async () => {
    mockGenerateContentFn.mockRejectedValue(new Error('AI service failed'));

    const props = createProps();
    const result = await handleCodeExecution!(props);

    expect(result.breakLoop).toBe(false);
    expect(result.items).toEqual([]);
    expect(mockPutSystemMessage).toHaveBeenCalledWith('Error during code execution: AI service failed');
  });

  it('should skip file selection in non-interactive mode', async () => {
    const aiResponse: GenerateContentResult = [
      { type: 'text', text: 'Result.' },
    ];
    mockGenerateContentFn.mockResolvedValue(aiResponse);

    const props = createProps({
      options: { aiService: 'ai-studio', askQuestion: true, interactive: false } as CodegenOptions,
    });
    await handleCodeExecution!(props);

    // askUserForInput should only be called once (for the post-result user input), not for file selection
    expect(mockAskUserForInput).toHaveBeenCalledTimes(1);
    expect(mockAskUserForInput).toHaveBeenCalledWith('Your answer', '', props.options);
  });

  it('should handle output files from code execution result', async () => {
    const mockFilesApiInstance = {
      uploadFile: vi.fn(),
      downloadFile: vi.fn().mockResolvedValue({
        filename: 'output.csv',
        content: Buffer.from('a,b,c'),
        mimeType: 'text/csv',
      }),
      deleteFile: vi.fn(),
    };
    mockGetFilesApiProvider.mockReturnValue(mockFilesApiInstance);
    mockAskUserForConfirmation.mockResolvedValue({ confirmed: true } as ReturnType<typeof userActions.askUserForConfirmation> extends Promise<infer T> ? T : never);

    const aiResponse: GenerateContentResult = [
      { type: 'text', text: 'Generated a file.' },
      {
        type: 'codeExecutionResult',
        outcome: 'OUTCOME_OK',
        output: 'Done',
        outputFiles: [{ fileId: 'file-123', filename: 'output.csv', size: 100 }],
      },
    ];
    mockGenerateContentFn.mockResolvedValue(aiResponse);

    const props = createProps();
    const result = await handleCodeExecution!(props);

    expect(mockGetFilesApiProvider).toHaveBeenCalledWith('ai-studio');
    expect(mockFilesApiInstance.downloadFile).toHaveBeenCalledWith('file-123');
    expect(result.items[0].assistant.codeExecutionResult?.outputFiles).toEqual([
      { fileId: 'file-123', filename: 'output.csv', size: 100 },
    ]);
  });

  it('should handle empty AI response gracefully', async () => {
    const aiResponse: GenerateContentResult = [];
    mockGenerateContentFn.mockResolvedValue(aiResponse);

    const props = createProps();
    const result = await handleCodeExecution!(props);

    // Falls back to iterate message when no text
    expect(result.items[0].assistant.text).toBe('I will execute some code to analyze the data.');
    expect(result.items[0].assistant.executableCode).toBeUndefined();
    expect(result.items[0].assistant.codeExecutionResult).toBeUndefined();
  });

  it('should pass no file references when non-interactive', async () => {
    const aiResponse: GenerateContentResult = [
      { type: 'text', text: 'Analyzed the data.' },
    ];
    mockGenerateContentFn.mockResolvedValue(aiResponse);

    const props = createProps({
      options: { aiService: 'ai-studio', askQuestion: true, interactive: false } as CodegenOptions,
    });
    await handleCodeExecution!(props);

    const [, configArg] = mockGenerateContentFn.mock.calls[0];
    expect(configArg.fileIds).toEqual([]);
    expect(configArg.uploadedFiles).toEqual([]);
  });
});
