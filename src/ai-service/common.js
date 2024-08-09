import assert from 'node:assert';
import { functionDefs } from '../prompt/function-calling.js';

/**
 * Common function to print token usage and estimated cost
 * @param {Object} usage Token usage object
 * @param {number} inputCostPerToken Cost per input token
 * @param {number} outputCostPerToken Cost per output token
 */
export function printTokenUsageAndCost(usage, inputCostPerToken, outputCostPerToken) {
  console.log('Token Usage:');
  console.log('  - Input tokens: ', usage.inputTokens);
  console.log('  - Output tokens: ', usage.outputTokens);
  console.log('  - Total tokens: ', usage.totalTokens);

  const inputCost = usage.inputTokens * inputCostPerToken;
  const outputCost = usage.outputTokens * outputCostPerToken;
  const totalCost = inputCost + outputCost;
  console.log('  - Estimated cost: ', totalCost.toFixed(6), ' USD');
}

/**
 * Common function to process function calls and explanations
 * @param {Array} functionCalls Array of function calls
 * @returns {Array} Processed function calls
 */
export function processFunctionCalls(functionCalls) {
  const unknownFunctionCalls = functionCalls.filter((call) => !functionDefs.some((fd) => fd.name === call.name));
  assert(
    unknownFunctionCalls.length === 0,
    'Unknown function name: ' + unknownFunctionCalls.map((call) => call.name).join(', '),
  );

  console.log(
    'Explanations:',
    functionCalls.filter((fn) => fn.name === 'explanation').map((call) => call.args.text),
  );

  return functionCalls; //.filter((fn) => fn.name !== 'explanation');
}
