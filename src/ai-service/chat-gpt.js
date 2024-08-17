import OpenAI from 'openai';
import { printTokenUsageAndCost, processFunctionCalls } from './common.js';

/**
 * This function generates content using the OpenAI chat model.
 */
export async function generateContent(prompt, functionDefs, requiredFunctionName, temperature, cheap = false) {
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
            content:
              item.images?.length > 0
                ? [
                    ...item.images.map((image) => ({
                      type: 'image_url',
                      image_url: {
                        url: 'data:' + image.mediaType + ';base64,' + image.base64url,
                      },
                    })),
                    {
                      type: 'text',
                      text: item.text,
                    },
                  ]
                : item.text,
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

  const model = cheap ? 'gpt-4o-mini' : 'gpt-4o-2024-08-06';
  console.log(`Using OpenAI model: ${model}`);

  let retryCount = 0;
  let response;
  while (retryCount < 3) {
    try {
      response = await openai.chat.completions.create({
        model: model,
        messages,
        tools: functionDefs.map((funDef) => ({ type: 'function', function: funDef })),
        tool_choice: requiredFunctionName ? { type: 'function', function: { name: requiredFunctionName } } : 'required',
        temperature: temperature,
      });
      break; // Exit loop if successful
    } catch (error) {
      if (error.response?.headers?.['x-ratelimit-limit-tokens']) {
        const rateLimitTokens = parseInt(error.response.headers['x-ratelimit-limit-tokens'], 10);
        const retryAfter = error.response.headers['retry-after']
          ? parseInt(error.response.headers['retry-after'], 10)
          : 1;
        console.log(
          `Rate limited. Token limit: ${rateLimitTokens}. Retrying after ${retryAfter} seconds. Attempt ${retryCount + 1} of 3.`,
        );
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        retryCount++;
      } else {
        console.error('An error occurred:', error);
        throw error; // Re-throw the error if it's not a rate limit error
      }
    }
  }

  if (retryCount === 3) {
    console.error('Failed to complete request after 3 attempts due to rate limiting.');
    throw new Error('Rate limit exceeded. Operation aborted.');
  }

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
