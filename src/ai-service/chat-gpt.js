import OpenAI from 'openai';
import { printTokenUsageAndCost, processFunctionCalls } from './common.js';

/**
 * This function generates content using the OpenAI chat model.
 */
export async function generateContent(prompt, functionDefs, requiredFunctionName, temperature) {
  const openai = new OpenAI();

  const messages = prompt
    .map((item) => {
      if (item.type === 'systemPrompt') {
        return {
          role: 'system',
          content: item.systemPrompt,
        };
      } else if (item.type === 'user') {
        return [
          ...(item.functionResponses ?? []).map((response) => ({
            role: 'tool',
            name: response.name,
            content: response.content ?? '',
            tool_call_id: response.name,
          })),
          {
            role: 'user',
            content: item.text,
          },
        ];
      } else if (item.type === 'assistant') {
        return {
          role: 'assistant',
          ...(item.text ? { content: item.text } : {}),
          tool_calls: item.functionCalls.map((call) => ({
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
            id: call.name,
          })),
        };
      }
    })
    .flat();

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    tools: functionDefs.map((funDef) => ({ type: 'function', function: funDef })),
    tool_choice: requiredFunctionName ? { type: 'function', function: { name: requiredFunctionName } } : 'required',
    temperature: temperature,
  });

  // Print token usage for chat gpt
  const usage = {
    inputTokens: response.usage.prompt_tokens,
    outputTokens: response.usage.completion_tokens,
    totalTokens: response.usage.total_tokens,
  };
  printTokenUsageAndCost(usage, 0.000005, 0.000015);

  const responseMessage = response.choices[0].message;

  if (responseMessage.content?.message) {
    console.log('Message', responseMessage.content.message);
  }

  const toolCalls = responseMessage.tool_calls;
  if (responseMessage.tool_calls) {
    const functionCalls = toolCalls.map((call) => {
      const name = call.function.name;
      const args = JSON.parse(call.function.arguments);

      return {
        name,
        args,
      };
    });

    return processFunctionCalls(functionCalls);
  } else {
    throw new Error('No tool calls found in response');
  }
}
