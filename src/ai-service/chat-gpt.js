import OpenAI from 'openai';
import { printTokenUsageAndCost, processFunctionCalls } from './common.js';

/**
 * This function generates content using the OpenAI chat model.
 *
 * @param systemPrompt System prompt for the chat model
 * @param prompt Prompt for the chat model
 * @returns Array of function calls
 */
export async function generateContent(prompt, functionDefs) {
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
          ...(item.functionResponse
            ? [
                {
                  role: 'tool',
                  name: item.functionResponse.name,
                  content: item.functionResponse.content,
                  tool_call_id: item.functionResponse.name,
                },
              ]
            : []),
          {
            role: 'user',
            content: item.text,
          },
        ];
      } else if (item.type === 'assistant') {
        return {
          role: 'assistant',
          content: item.text,
          tool_calls: [
            {
              type: 'function',
              function: { name: item.functionCall.name, arguments: item.functionCall.args ?? '{}' },
              id: item.functionCall.name,
            },
          ],
        };
      }
    })
    .flat();

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
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
