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
  const unknownFunctionCalls = functionCalls.filter((call) => !functionDefs.some((fd) => fd.name === call.name));
  if (unknownFunctionCalls.length > 0) {
    console.warn('Unknown function name: ' + unknownFunctionCalls.map((call) => call.name).join(', '));
  }

  return functionCalls;
}

/**
 * Optimize function definitions based on prompt context
 */
export function optimizeFunctionDefs(
  prompt: PromptItem[],
  functionDefs: FunctionDef[] | undefined,
  requiredFunctionName: string | undefined,
): FunctionDef[] {
  if (!functionDefs) return [];

  const promptFunctionNames = new Set(
    prompt.map((item) => item.functionCalls).flatMap((fcs) => fcs?.map((fc) => fc.name)),
  );
  return functionDefs.filter(
    (def) => promptFunctionNames.has(def.name) || !requiredFunctionName || def.name === requiredFunctionName,
  );
}
