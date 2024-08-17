import Anthropic from '@anthropic-ai/sdk';
import { printTokenUsageAndCost, processFunctionCalls } from './common.js';

/**
 * This function generates content using the Anthropic Claude model.
 */
export async function generateContent(prompt, functionDefs, requiredFunctionName, temperature, cheap = false) {
  const anthropic = new Anthropic({
    defaultHeaders: {
      'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15,prompt-caching-2024-07-31',
    },
  });

  const messages = prompt
    .filter((item) => item.type !== 'systemPrompt')
    .map((item) => {
      if (item.type === 'user') {
        return {
          role: 'user',
          content: [
            ...(item.functionResponses ?? []).map((response) => ({
              tool_use_id: response.call_id ?? response.name,
              content: response.content,
              type: 'tool_result',
              is_error: response.isError === true,
            })),
            ...(item.images ?? []).map((image) => ({
              type: 'image',
              source: {
                type: 'base64',
                media_type: image.mediaType,
                data: image.base64url,
              },
            })),
            {
              type: 'text',
              text: item.text,
              ...(item.cache ? { cache_control: { type: 'ephemeral' } } : {}),
            },
          ],
        };
      } else if (item.type === 'assistant') {
        return {
          role: 'assistant',
          content: [
            ...(item.text ? [{ type: 'text', text: item.text }] : []),
            ...item.functionCalls.map((call) => ({
              id: call.id ?? call.name,
              name: call.name,
              input: call.args ?? {},
              type: 'tool_use',
            })),
          ],
        };
      }
    });

  const model = cheap ? 'claude-3-haiku-20240307' : 'claude-3-5-sonnet-20240620';
  console.log(`Using Anthropic model: ${model}`);

  let retryCount = 0;
  let response;
  while (retryCount < 3) {
    try {
      response = await anthropic.beta.promptCaching.messages.create({
        model: model,
        system: prompt.find((item) => item.type === 'systemPrompt').systemPrompt,
        messages,
        tools: functionDefs.map((fd) => ({
          name: fd.name,
          description: fd.description,
          input_schema: fd.parameters,
        })),
        tool_choice: requiredFunctionName ? { type: 'tool', name: requiredFunctionName } : { type: 'any' },
        max_tokens: cheap ? 4096 : 8192,
        temperature: temperature,
      });
      break; // Exit loop if successful
    } catch (error) {
      if (error.headers?.['retry-after']) {
        const retryAfter = parseInt(error.headers['retry-after'], 10);
        console.log(`Rate limited. Retrying after ${retryAfter} seconds. Attempt ${retryCount + 1} of 3.`);
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

  // Print token usage for Anthropic
  const usage = {
    cacheCreateTokens: response.usage.cache_creation_input_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
  };
  printTokenUsageAndCost(usage, 3 / 1000 / 1000, 15 / 1000 / 1000);

  const responseMessages = response.content.filter((item) => item.type !== 'tool_use');
  if (responseMessages.length > 0) {
    console.log('Response messages', responseMessages);
  }

  const functionCalls = response.content
    .filter((item) => item.type === 'tool_use')
    .map((item) => ({
      name: item.name,
      args: item.input,
    }));

  return processFunctionCalls(functionCalls);
}
