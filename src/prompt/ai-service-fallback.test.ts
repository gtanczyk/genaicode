import { vi, describe, it, expect, Mock, afterEach } from 'vitest';
import { handleAiServiceFallback } from './ai-service-fallback';
import { GenerateFunctionCallsFunction } from '../ai-service/common-types';
import { FunctionCall } from '../ai-service/common-types';
import { ModelType } from '../ai-service/common-types';
import { CodegenOptions } from '../main/codegen-types';
import { askUserForConfirmation } from '../main/common/user-actions';
import { validateAndRecoverSingleResult } from './steps/step-validate-recover';

vi.mock('../main/common/user-actions', () => ({
  askUserForConfirmation: vi.fn(),
}));

vi.mock('./steps/step-validate-recover', () => ({
  validateAndRecoverSingleResult: vi.fn(),
}));

describe('handleAiServiceFallback', () => {
  const mockGenerateContent: GenerateFunctionCallsFunction = vi.fn();
  const mockOptions: CodegenOptions = {
    askQuestion: false,
    aiService: 'openai',
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

    // Mock validation to succeed
    vi.mocked(validateAndRecoverSingleResult).mockResolvedValue(expectedFunctionCalls);

    // Mock user confirmation to always return true
    vi.mocked(askUserForConfirmation).mockResolvedValue({ confirmed: true });

    const result = await handleAiServiceFallback(
      {
        openai: mockGenerateContent,
        anthropic: mockGenerateContent,
        'vertex-ai': mockGenerateContent,
        'ai-studio': mockGenerateContent,
        'vertex-ai-claude': mockGenerateContent,
        'local-llm': mockGenerateContent,
      },
      mockOptions,
      [],
      [],
      null,
      0.5,
      ModelType.DEFAULT,
      mockOptions,
    );

    expect(result).toEqual(expectedFunctionCalls);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(validateAndRecoverSingleResult).toHaveBeenCalledWith(
      [[], [], null, 0.5, ModelType.DEFAULT, mockOptions],
      expectedFunctionCalls,
      mockGenerateContent,
    );
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
          openai: mockGenerateContent,
          anthropic: mockGenerateContent,
          'vertex-ai': mockGenerateContent,
          'ai-studio': mockGenerateContent,
          'vertex-ai-claude': mockGenerateContent,
          'local-llm': mockGenerateContent,
        },
        options,
        [],
        [],
        null,
        0.5,
        ModelType.DEFAULT,
        options,
      ),
    ).rejects.toThrow('Service failure');

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(options.aiService).toEqual('openai');
  });

  it('handles validation failure and retries with user confirmation', async () => {
    // Mock the first AI service call to succeed but with invalid result
    const invalidFunctionCalls: FunctionCall[] = [{ name: 'test', args: {} }];
    (mockGenerateContent as Mock).mockResolvedValueOnce(invalidFunctionCalls);

    // Mock validation to fail first time
    vi.mocked(validateAndRecoverSingleResult).mockRejectedValueOnce(new Error('Validation failed'));

    // Mock user confirmation to retry
    vi.mocked(askUserForConfirmation).mockResolvedValue({ confirmed: true });

    // Mock the second AI service call to succeed with valid result
    const validFunctionCalls: FunctionCall[] = [{ name: 'test', args: { valid: true } }];
    (mockGenerateContent as Mock).mockResolvedValueOnce(validFunctionCalls);

    // Mock validation to succeed second time
    vi.mocked(validateAndRecoverSingleResult).mockResolvedValueOnce(validFunctionCalls);

    const result = await handleAiServiceFallback(
      {
        openai: mockGenerateContent,
        anthropic: mockGenerateContent,
        'vertex-ai': mockGenerateContent,
        'ai-studio': mockGenerateContent,
        'vertex-ai-claude': mockGenerateContent,
        'local-llm': mockGenerateContent,
      },
      mockOptions,
      [],
      [],
      null,
      0.5,
      ModelType.DEFAULT,
      mockOptions,
    );

    expect(result).toEqual(validFunctionCalls);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(validateAndRecoverSingleResult).toHaveBeenCalledTimes(2);
  });

  it('throws error when validation fails and user declines retry', async () => {
    // Mock the AI service call to succeed but with invalid result
    const invalidFunctionCalls: FunctionCall[] = [{ name: 'test', args: {} }];
    (mockGenerateContent as Mock).mockResolvedValueOnce(invalidFunctionCalls);

    // Mock validation to fail
    const validationError = new Error('Validation failed');
    vi.mocked(validateAndRecoverSingleResult).mockRejectedValueOnce(validationError);

    // Mock user confirmation to decline retry
    vi.mocked(askUserForConfirmation).mockResolvedValue({ confirmed: false });

    await expect(
      handleAiServiceFallback(
        {
          openai: mockGenerateContent,
          anthropic: mockGenerateContent,
          'vertex-ai': mockGenerateContent,
          'ai-studio': mockGenerateContent,
          'vertex-ai-claude': mockGenerateContent,
          'local-llm': mockGenerateContent,
        },
        mockOptions,
        [],
        [],
        null,
        0.5,
        ModelType.DEFAULT,
        mockOptions,
      ),
    ).rejects.toThrow('Validation failed');

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(validateAndRecoverSingleResult).toHaveBeenCalledTimes(1);
  });
});
