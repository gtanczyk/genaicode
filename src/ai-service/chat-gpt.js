import OpenAI from 'openai';
import { functionDefs } from './function-calling.js';
import { prepareMessages, printTokenUsageAndCost, processFunctionCalls } from './common.js';

/**
 * This function generates content using the OpenAI chat model.
 *
 * @param systemPrompt System prompt for the chat model
 * @param prompt Prompt for the chat model
 * @returns Array of function calls
 */
export async function generateContent(systemPrompt, prompt) {
  const openai = new OpenAI();

  const messages = prepareMessages(prompt);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: mapCommonMessages(systemPrompt, messages),
    tools: functionDefs.map((funDef) => ({ type: 'function', function: funDef })),
    tool_choice: 'required',
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

function mapCommonMessages(systemPrompt, messages) {
  return [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: messages.suggestSourceCode,
    },
    {
      role: 'assistant',
      content: messages.requestSourceCode,
      tool_calls: [{ type: 'function', function: { name: 'getSourceCode', arguments: '{}' }, id: 'get_source_code' }],
    },
    {
      role: 'tool',
      name: 'getSourceCode',
      content: messages.sourceCode,
      tool_call_id: 'get_source_code',
    },
    {
      role: 'user',
      content: messages.prompt,
    },
  ];
}
