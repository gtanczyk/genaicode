import OpenAI, { APIError } from 'openai';
import assert from 'node:assert';
import {
  printTokenUsageAndCost,
  processFunctionCalls,
  FunctionCall,
  PromptItem,
  FunctionDef,
  TokenUsage,
} from './common.js';
import { ChatCompletionContentPartText, ChatCompletionMessageParam } from 'openai/resources/index';
import { abortController } from '../main/interactive/codegen-worker.js';
import { modelOverrides } from '../main/config.js';

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

  const defaultModel = cheap ? 'gpt-4o-mini' : 'gpt-4o-2024-08-06';
  const model = cheap
    ? (modelOverrides.chatGpt?.cheap ?? defaultModel)
    : (modelOverrides.chatGpt?.default ?? defaultModel);

  return internalGenerateContent(prompt, functionDefs, requiredFunctionName, temperature, cheap, model, openai);
}

export async function internalGenerateContent(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  cheap = false,
  model: string,
  openai: OpenAI,
): Promise<FunctionCall[]> {
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
          content: [
            ...(item.text ? [{ type: 'text', text: item.text }] : []),
            // Currently broken: https://github.com/openai/openai-node/issues/1030
            ...(item.images ?? []).map((image) => ({
              type: 'image_url' as const,
              image_url: {
                url: 'data:' + image.mediaType + ';base64,' + image.base64url,
              },
            })),
          ] as ChatCompletionContentPartText[],
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

  console.log(`Using OpenAI model: ${model}`);
  assert(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY environment variable is not set');

  let retryCount = 0;
  const maxRetries = 3;
  let response: OpenAI.Chat.Completions.ChatCompletion | undefined = undefined;

  while (retryCount < maxRetries) {
    try {
      response = await openai.chat.completions.create(
        {
          model: model,
          messages,
          tools: functionDefs.map((funDef) => ({ type: 'function' as const, function: funDef })),
          tool_choice: requiredFunctionName
            ? { type: 'function' as const, function: { name: requiredFunctionName } }
            : 'required',
          temperature: temperature,
        },
        { signal: abortController?.signal },
      );
      break; // Exit loop if successful
    } catch (error) {
      if (error instanceof APIError && error.status === 429) {
        // Rate limit error
        let retryAfter = error.headers?.['retry-after'] ? parseInt(error.headers['retry-after'], 10) : 60;
        retryAfter = Math.min(retryAfter, 30);
        console.log(`Rate limited. Retrying after ${retryAfter} seconds. Attempt ${retryCount + 1} of ${maxRetries}.`);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        retryCount++;
      } else {
        console.error('An error occurred:', error);
        throw new Error('API request failed. Operation aborted.');
      }
    }
  }

  if (retryCount === maxRetries) {
    console.error(`Failed to complete request after ${maxRetries} attempts due to rate limiting.`);
    throw new Error('Rate limit exceeded. Operation aborted.');
  }

  assert(response);

  // Print token usage for chat gpt
  const usage: TokenUsage = {
    inputTokens: response.usage!.prompt_tokens - (response.usage?.prompt_tokens_details?.cached_tokens ?? 0),
    outputTokens: response.usage!.completion_tokens,
    totalTokens: response.usage!.total_tokens,
    cacheReadTokens: response.usage?.prompt_tokens_details?.cached_tokens,
  };
  printTokenUsageAndCost({
    aiService: 'chat-gpt',
    usage,
    inputCostPerToken: 0.000005,
    outputCostPerToken: 0.000015,
    cheap,
  });

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

    return processFunctionCalls(functionCalls, functionDefs);
  } else {
    throw new Error('No tool calls found in response');
  }
}
