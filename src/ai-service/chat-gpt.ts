import OpenAI, { APIError } from 'openai';
import assert from 'node:assert';
import { printTokenUsageAndCost, processFunctionCalls, FunctionCall, PromptItem, FunctionDef } from './common.js';
import { ChatCompletionMessageParam } from 'openai/resources/index.mjs';

/**
 * This function generates content using the OpenAI chat model.
 */
export async function generateContent(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  cheap = false,
): Promise<FunctionCall[]> {
  const openai = new OpenAI();

  const messages: Array<ChatCompletionMessageParam> = prompt
    .map((item) => {
      if (item.type === 'systemPrompt') {
        return {
          role: 'system' as const,
          content: item.systemPrompt!,
        };
      } else if (item.type === 'user') {
        const messages: ChatCompletionMessageParam[] = [];
        if (item.functionResponses) {
          messages.push(
            ...item.functionResponses.map((response) => ({
              role: 'tool' as const,
              name: response.name,
              content: response.content ?? '',
              tool_call_id: response.name,
            })),
          );
        }
        if ((item.images?.length ?? 0) > 0) {
          messages.push({
            role: 'user' as const,
            content: [
              ...item.images!.map((image) => ({
                type: 'image_url' as const,
                image_url: {
                  url: 'data:' + image.mediaType + ';base64,' + image.base64url,
                },
              })),
              {
                type: 'text' as const,
                text: item.text!,
              },
            ],
          });
        } else {
          messages.push({
            role: 'user' as const,
            content: item.text!,
          });
        }
        return messages;
      } else {
        assert(item.type === 'assistant');
        const message: ChatCompletionMessageParam = {
          role: 'assistant' as const,
          ...(item.text ? { content: item.text } : {}),
          tool_calls: item.functionCalls?.map((call) => ({
            type: 'function' as const,
            function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
            id: call.name,
          })),
        };
        return message;
      }
    })
    .flat();

  const model = cheap ? 'gpt-4o-mini' : 'gpt-4o-2024-08-06';
  console.log(`Using OpenAI model: ${model}`);

  let retryCount = 0;
  let response: OpenAI.Chat.Completions.ChatCompletion | undefined = undefined;
  while (retryCount < 3) {
    try {
      response = await openai.chat.completions.create({
        model: model,
        messages,
        tools: functionDefs.map((funDef) => ({ type: 'function' as const, function: funDef })),
        tool_choice: requiredFunctionName
          ? { type: 'function' as const, function: { name: requiredFunctionName } }
          : 'required',
        temperature: temperature,
      });
      break; // Exit loop if successful
    } catch (error) {
      if (error instanceof APIError && error.headers?.['x-ratelimit-limit-tokens']) {
        const rateLimitTokens = parseInt(error.headers['x-ratelimit-limit-tokens'], 10);
        const retryAfter = error.headers['retry-after'] ? parseInt(error.headers['retry-after'], 10) : 1;
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

  assert(response);

  // Print token usage for chat gpt
  const usage = {
    inputTokens: response.usage!.prompt_tokens,
    outputTokens: response.usage!.completion_tokens,
    totalTokens: response.usage!.total_tokens,
  };
  printTokenUsageAndCost(usage, 0.000005, 0.000015);

  const responseMessage = response.choices[0].message;

  if (responseMessage.content) {
    console.log('Message', responseMessage.content);
  }

  const toolCalls = responseMessage.tool_calls;
  if (toolCalls) {
    const functionCalls = toolCalls.map((call) => {
      const name = call.function.name;
      const args = JSON.parse(call.function.arguments);

      return {
        id: call.id,
        name,
        args,
      };
    });

    return processFunctionCalls(functionCalls);
  } else {
    throw new Error('No tool calls found in response');
  }
}
