import { AiServiceType } from './service-configurations-types.js';
import { collectCost } from '../main/common/cost-collector.js';
import { FunctionCall, FunctionDef, ModelType, PromptItem, TokenUsage } from './common-types.js';

interface CostInfo {
  aiService: AiServiceType;
  usage: TokenUsage;
  inputCostPerToken: number;
  outputCostPerToken: number;
  modelType: ModelType;
}

/**
 * Common function to print token usage and estimated cost
 * @param {CostInfo} costInfo Cost information object
 */
export function printTokenUsageAndCost(costInfo: CostInfo): void {
  const { usage, inputCostPerToken, outputCostPerToken, modelType } = costInfo;

  console.log('Token Usage:');
  console.log('  - Input tokens: ', usage.inputTokens ?? 0);
  if (usage.cacheCreateTokens) {
    console.log('  - Cache create tokens: ', usage.cacheCreateTokens);
  }
  if (usage.cacheReadTokens) {
    console.log('  - Cache read tokens: ', usage.cacheReadTokens);
  }
  if (usage.thinkingTokens) {
    console.log('  - Thinking tokens: ', usage.thinkingTokens);
  }
  console.log('  - Output tokens: ', usage.outputTokens ?? 0);
  console.log('  - Total tokens: ', usage.totalTokens ?? 0);

  // Calculate cost multiplier based on model type
  const costMultiplier = (() => {
    switch (modelType) {
      case ModelType.CHEAP:
        return 0.1;
      case ModelType.REASONING:
        return 2; // Reasoning models are very expensive
      default:
        return 1.0;
    }
  })();

  const inputCost =
    ((usage.inputTokens ?? 0) * inputCostPerToken +
      (usage.cacheCreateTokens ?? 0) * inputCostPerToken * 1.25 +
      (usage.cacheReadTokens ?? 0) * inputCostPerToken * 0.2) *
    costMultiplier;
  const outputCost = (usage.outputTokens ?? 0) * outputCostPerToken * costMultiplier;
  const totalCost = inputCost + outputCost;

  console.log('  - Estimated cost: ', totalCost.toFixed(6), ' USD');

  collectCost(
    totalCost,
    (usage.totalTokens ?? 0) - (usage.outputTokens ?? 0),
    usage.outputTokens ?? 0,
    costInfo.aiService,
    modelType,
  );
}

/**
 * Common function to process function calls and explanations
 */
export function processFunctionCalls(functionCalls: FunctionCall[], functionDefs: FunctionDef[]): FunctionCall[] {
  if (!Array.isArray(functionCalls)) {
    console.warn('Invalid function calls: expected array, got', typeof functionCalls);
    return [];
  }

  if (!Array.isArray(functionDefs)) {
    console.warn('Invalid function definitions: expected array, got', typeof functionDefs);
    return functionCalls; // Return as-is if we can't validate
  }

  const functionDefNames = new Set(functionDefs.map((fd) => fd.name));
  const validFunctionCalls: FunctionCall[] = [];
  const unknownFunctionCalls: FunctionCall[] = [];

  for (const call of functionCalls) {
    if (!call || typeof call !== 'object' || typeof call.name !== 'string') {
      console.warn('Invalid function call structure:', call);
      continue;
    }

    if (functionDefNames.has(call.name)) {
      validFunctionCalls.push(call);
    } else {
      unknownFunctionCalls.push(call);
    }
  }

  if (unknownFunctionCalls.length > 0) {
    console.warn('Unknown function name: ' + unknownFunctionCalls.map((call) => call.name).join(', '));
  }

  // Return all function calls to maintain backward compatibility, but log warnings for unknown ones
  return [...validFunctionCalls, ...unknownFunctionCalls];
}

/**
 * Optimize function definitions based on prompt context
 */
export function optimizeFunctionDefs(
  prompt: PromptItem[],
  functionDefs: FunctionDef[] | undefined,
  requiredFunctionName: string | undefined,
): FunctionDef[] {
  if (!functionDefs || !Array.isArray(functionDefs)) {
    return [];
  }

  if (!Array.isArray(prompt)) {
    console.warn('Invalid prompt: expected array, got', typeof prompt);
    return functionDefs; // Return all function defs if we can't analyze the prompt
  }

  const promptFunctionNames = new Set<string>();

  // Extract function names from prompt items with better error handling
  for (const item of prompt) {
    if (item && typeof item === 'object' && item.functionCalls && Array.isArray(item.functionCalls)) {
      for (const fc of item.functionCalls) {
        if (fc && typeof fc === 'object' && typeof fc.name === 'string') {
          promptFunctionNames.add(fc.name);
        }
      }
    }
  }

  return functionDefs.filter((def) => {
    if (!def || typeof def !== 'object' || typeof def.name !== 'string') {
      console.warn('Invalid function definition:', def);
      return false;
    }

    return promptFunctionNames.has(def.name) || !requiredFunctionName || def.name === requiredFunctionName;
  });
}
