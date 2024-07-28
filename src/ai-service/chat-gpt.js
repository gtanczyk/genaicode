import OpenAI from 'openai';
import { functionDefs } from './function-calling.js';
import { prepareMessages, printTokenUsageAndCost, processFunctionCalls } from './common.js';
import { chatGptModel } from '../cli/cli-params.js';

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
    model: chatGptModel,
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
  printTokenUsageAndCost(usage, chatGptModel);

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
    ...messages.flatMap((message) => {
      if (message.role === 'user') {
        return {
          role: message.role,
          content: message.parts.map((part) => part.text).join('\n'),
        };
      } else {
        return [
          {
            role: 'assistant',
            content: message.parts
              .filter((part) => part.text)
              .map((part) => part.text)
              .join('\n'),
            tool_calls: message.parts
              .filter((part) => part.functionCall)
              .map((part) => ({
                type: 'function',
                function: {
                  name: part.functionCall.name,
                  arguments: JSON.stringify(part.functionCall.args),
                },
                id: part.functionCall.name,
              })),
          },
          ...message.parts
            .filter((part) => part.functionResponse)
            .map((part) => ({
              role: 'tool',
              name: part.functionResponse.name,
              content: JSON.stringify(part.functionResponse.response.content),
              tool_call_id: part.functionResponse.name,
            })),
        ];
      }
    }),
  ];
}
