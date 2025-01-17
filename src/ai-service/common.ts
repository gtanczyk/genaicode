import { CodegenOptions, AiServiceType } from '../main/codegen-types.js';
import { collectCost } from '../main/common/cost-collector.js';

export interface TokenUsage {
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

export interface FunctionCall<T = Record<string, unknown>> {
  id?: string;
  name: string;
  args?: T;
}

export type PromptImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export type PromptItemImage = {
  mediaType: PromptImageMediaType;
  base64url: string;
};

export interface PromptItem {
  type: 'systemPrompt' | 'user' | 'assistant';
  systemPrompt?: string;
  text?: string;
  functionResponses?: {
    call_id?: string;
    name: string;
    content?: string;
    isError?: boolean;
  }[];
  images?: PromptItemImage[];
  functionCalls?: FunctionCall[];
  cache?: boolean;
}

export type GenerateContentArgs = [
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  cheap?: boolean,
  options?: Partial<CodegenOptions>,
];

export type GenerateContentFunction = (...args: GenerateContentArgs) => Promise<FunctionCall[]>;

export type GenerateImageFunction = (
  prompt: string,
  contextImagePath: string | undefined,
  size: { width: number; height: number },
  cheap: boolean,
) => Promise<string>;

interface CostInfo {
  aiService: AiServiceType;
  usage: TokenUsage;
  inputCostPerToken: number;
  outputCostPerToken: number;
  cheap: boolean;
}

/**
 * Common function to print token usage and estimated cost
 * @param {CostInfo} costInfo Cost information object
 */
export function printTokenUsageAndCost(costInfo: CostInfo): void {
  const { usage, inputCostPerToken, outputCostPerToken, cheap } = costInfo;

  console.log('Token Usage:');
  console.log('  - Input tokens: ', usage.inputTokens ?? 0);
  if (usage.cacheCreateTokens) {
    console.log('  - Cache create tokens: ', usage.cacheCreateTokens);
  }
  if (usage.cacheReadTokens) {
    console.log('  - Cache read tokens: ', usage.cacheReadTokens);
  }
  console.log('  - Output tokens: ', usage.outputTokens ?? 0);
  console.log('  - Total tokens: ', usage.totalTokens ?? 0);

  const inputCost =
    ((usage.inputTokens ?? 0) * inputCostPerToken +
      (usage.cacheCreateTokens ?? 0) * inputCostPerToken * 1.25 +
      (usage.cacheReadTokens ?? 0) * inputCostPerToken * 0.2) *
    (cheap ? 0.1 : 1);
  const outputCost = (usage.outputTokens ?? 0) * outputCostPerToken;
  const totalCost = inputCost + outputCost;

  console.log('  - Estimated cost: ', totalCost.toFixed(6), ' USD');

  collectCost(totalCost, usage.inputTokens ?? 0, usage.outputTokens ?? 0, costInfo.aiService, cheap);
}

/**
 * Common function to process function calls and explanations
 */
export function processFunctionCalls(functionCalls: FunctionCall[], functionDefs: FunctionDef[]): FunctionCall[] {
  const unknownFunctionCalls = functionCalls.filter((call) => !functionDefs.some((fd) => fd.name === call.name));
  if (unknownFunctionCalls.length > 0) {
    console.warn('Unknown function name: ' + unknownFunctionCalls.map((call) => call.name).join(', '));
  }

  return functionCalls;
}
