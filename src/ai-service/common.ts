import assert from 'node:assert';
import { functionDefs } from '../prompt/function-calling.js';
import { CodegenOptions } from '../main/codegen-types.js';

interface TokenUsage {
  inputTokens: number | undefined | null;
  outputTokens: number | undefined | null;
  totalTokens: number | undefined | null;
  cacheCreateTokens?: number | null;
  cacheReadTokens?: number | null;
}

export interface FunctionDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface FunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

export interface PromptItem {
  type: string;
  systemPrompt?: string;
  text?: string;
  functionResponses?: {
    call_id?: string;
    name: string;
    content?: string;
    isError?: boolean;
  }[];
  images?: {
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    base64url: string;
  }[];
  functionCalls?: FunctionCall[];
  cache?: boolean;
}

export type GenerateContentFunction = (
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string,
  temperature: number,
  cheap: boolean,
  options: CodegenOptions,
) => Promise<FunctionCall[]>;

export type GenerateImageFunction = (
  prompt: string,
  contextImagePath: string | undefined,
  size: { width: number; height: number },
  cheap: boolean,
) => Promise<string>;

/**
 * Common function to print token usage and estimated cost
 * @param {TokenUsage} usage Token usage object
 * @param {number} inputCostPerToken Cost per input token
 * @param {number} outputCostPerToken Cost per output token
 */
export function printTokenUsageAndCost(usage: TokenUsage, inputCostPerToken: number, outputCostPerToken: number): void {
  console.log('Token Usage:');
  console.log('  - Input tokens: ', usage.inputTokens);
  console.log('  - Output tokens: ', usage.outputTokens);
  console.log('  - Total tokens: ', usage.totalTokens);
  if (usage.cacheCreateTokens) {
    console.log('  - Cache create tokens: ', usage.cacheCreateTokens);
  }
  if (usage.cacheReadTokens) {
    console.log('  - Cache read tokens: ', usage.cacheReadTokens);
  }

  const inputCost =
    (usage.inputTokens ?? 0) * inputCostPerToken +
    (usage.cacheCreateTokens ?? 0) * inputCostPerToken * 1.25 +
    (usage.cacheReadTokens ?? 0) * inputCostPerToken * 0.2;
  const outputCost = (usage.outputTokens ?? 0) * outputCostPerToken;
  const totalCost = inputCost + outputCost;
  console.log('  - Estimated cost: ', totalCost.toFixed(6), ' USD');
}

/**
 * Common function to process function calls and explanations
 * @param {FunctionCall[]} functionCalls Array of function calls
 * @returns {FunctionCall[]} Processed function calls
 */
export function processFunctionCalls(functionCalls: FunctionCall[]): FunctionCall[] {
  const unknownFunctionCalls = functionCalls.filter((call) => !functionDefs.some((fd) => fd.name === call.name));
  assert(
    unknownFunctionCalls.length === 0,
    'Unknown function name: ' + unknownFunctionCalls.map((call) => call.name).join(', '),
  );

  console.log(
    'Explanations:',
    functionCalls.filter((fn) => fn.name === 'explanation').map((call) => call.args?.text),
  );

  return functionCalls; // .filter((fn) => fn.name !== 'explanation');
}
