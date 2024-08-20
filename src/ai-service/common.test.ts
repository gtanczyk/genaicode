import { describe, it, expect, vi, beforeEach, afterEach, MockInstance } from 'vitest';
import { printTokenUsageAndCost, processFunctionCalls } from './common.js';
import { functionDefs } from '../prompt/function-calling.js';

// Mock cli-params.js
vi.mock('../cli/cli-params.ts', () => ({
  chatGpt: true,
  anthropic: false,
  vertexAi: false,
  vertexAiClaude: false,
  temperature: 0.7,
  cheap: false,
  geminiBlockNone: false,
  requireExplanations: false,
  vision: false,
}));

describe('printTokenUsageAndCost', () => {
  let consoleLogSpy: MockInstance<{
    (...data: unknown[]): void;
    (message?: unknown, ...optionalParams: unknown[]): void;
  }>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should correctly log token usage and estimated cost', () => {
    const usage = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    };
    const inputCostPerToken = 0.0001;
    const outputCostPerToken = 0.0002;

    printTokenUsageAndCost(usage, inputCostPerToken, outputCostPerToken);

    expect(consoleLogSpy).toHaveBeenCalledTimes(5);
    expect(consoleLogSpy).toHaveBeenCalledWith('Token Usage:');
    expect(consoleLogSpy).toHaveBeenCalledWith('  - Input tokens: ', 100);
    expect(consoleLogSpy).toHaveBeenCalledWith('  - Output tokens: ', 50);
    expect(consoleLogSpy).toHaveBeenCalledWith('  - Total tokens: ', 150);
    expect(consoleLogSpy).toHaveBeenCalledWith('  - Estimated cost: ', '0.020000', ' USD');
  });

  it('should handle zero tokens correctly', () => {
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    const inputCostPerToken = 0.0001;
    const outputCostPerToken = 0.0002;

    printTokenUsageAndCost(usage, inputCostPerToken, outputCostPerToken);

    expect(consoleLogSpy).toHaveBeenCalledWith('  - Estimated cost: ', '0.000000', ' USD');
  });
});

describe('processFunctionCalls', () => {
  it('should process valid function calls correctly', () => {
    const validFunctionCalls = [
      { name: 'explanation', args: { text: 'This is an explanation' } },
      { name: functionDefs[0].name, args: {} },
    ];

    const result = processFunctionCalls(validFunctionCalls);

    expect(result).toEqual(validFunctionCalls);
  });

  it('should throw an error for unknown function names', () => {
    const invalidFunctionCalls = [{ name: 'unknownFunction', args: {} }];

    expect(() => processFunctionCalls(invalidFunctionCalls)).toThrow('Unknown function name: unknownFunction');
  });

  it('should correctly handle explanations', () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const functionCallsWithExplanation = [
      { name: 'explanation', args: { text: 'This is an explanation' } },
      { name: functionDefs[0].name, args: {} },
    ];

    processFunctionCalls(functionCallsWithExplanation);

    expect(consoleLogSpy).toHaveBeenCalledWith('Explanations:', ['This is an explanation']);

    consoleLogSpy.mockRestore();
  });

  it('should return all function calls including explanations', () => {
    const functionCalls = [
      { name: 'explanation', args: { text: 'This is an explanation' } },
      { name: functionDefs[0].name, args: {} },
    ];

    const result = processFunctionCalls(functionCalls);

    expect(result).toEqual(functionCalls);
    expect(result.length).toBe(2);
  });
});
