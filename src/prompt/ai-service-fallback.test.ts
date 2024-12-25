import { vi, describe, it, expect, Mock, afterEach } from 'vitest';
import { handleAiServiceFallback } from './ai-service-fallback';
import { GenerateContentFunction, FunctionCall } from '../ai-service/common';
import { CodegenOptions } from '../main/codegen-types';
import { askUserForConfirmation } from '../main/common/user-actions';

vi.mock('../main/common/user-actions', () => ({
  askUserForConfirmation: vi.fn(),
}));

describe('handleAiServiceFallback', () => {
  const mockGenerateContent: GenerateContentFunction = vi.fn();
  const mockOptions: CodegenOptions = {
    askQuestion: false,
    aiService: 'chat-gpt',
    disableAiServiceFallback: false,
    interactive: true,
    ui: false,
  };

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('asks the user if they want to retry', async () => {
    // Mock the first AI service call to be rate limited
    (mockGenerateContent as Mock).mockRejectedValueOnce(new Error('Rate limit exceeded'));

    // Mock the second AI service call to succeed
    const expectedFunctionCalls: FunctionCall[] = [{ name: 'test', args: {} }];
    (mockGenerateContent as Mock).mockResolvedValueOnce(expectedFunctionCalls);

    // Mock user confirmation to always return true
    vi.mocked(askUserForConfirmation).mockResolvedValue({ confirmed: true });

    const result = await handleAiServiceFallback(
      {
        'chat-gpt': mockGenerateContent,
        anthropic: mockGenerateContent,
        'vertex-ai': mockGenerateContent,
        'ai-studio': mockGenerateContent,
        'vertex-ai-claude': mockGenerateContent,
      },
      'chat-gpt',
      mockOptions,
      [],
      [],
      null,
      0.5,
      false,
      mockOptions,
    );

    expect(result).toEqual(expectedFunctionCalls);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('does not retry if disableAiServiceFallback is true', async () => {
    // Mock the first AI service call to fail
    (mockGenerateContent as Mock).mockRejectedValueOnce(new Error('Service failure'));

    // Set disableAiServiceFallback to true
    const options: CodegenOptions = {
      ...mockOptions,
      disableAiServiceFallback: true,
    };

    await expect(
      handleAiServiceFallback(
        {
          'chat-gpt': mockGenerateContent,
          anthropic: mockGenerateContent,
          'vertex-ai': mockGenerateContent,
          'ai-studio': mockGenerateContent,
          'vertex-ai-claude': mockGenerateContent,
        },
        'chat-gpt',
        options,
        [],
        [],
        null,
        0.5,
        false,
        options,
      ),
    ).rejects.toThrow('Service failure');

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(options.aiService).toEqual('chat-gpt');
  });
});
