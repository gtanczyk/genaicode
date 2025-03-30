import OpenAI, { APIError } from 'openai';
import assert from 'node:assert';
import { printTokenUsageAndCost, processFunctionCalls } from './common.js';
import { GenerateContentFunction } from './common-types.js';
import { PromptItem } from './common-types.js';
import { FunctionCall } from './common-types.js';
import { FunctionDef } from './common-types.js';
import { TokenUsage } from './common-types.js';
import { ModelType } from './common-types.js';
import { ChatCompletionContentPartText, ChatCompletionMessageParam } from 'openai/resources/index';
import { abortController } from '../main/common/abort-controller.js';
import { getServiceConfig } from './service-configurations.js';
import { AiServiceType } from './service-configurations-types.js';

/**
 * This function generates content using the OpenAI chat model.
 */
export const generateContent: GenerateContentFunction = async function generateContent(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  modelType = ModelType.DEFAULT,
): Promise<FunctionCall[]> {
  try {
    const serviceConfig = getServiceConfig('openai');
    assert(serviceConfig?.apiKey, 'OpenAI API key not configured, use OPENAI_API_KEY environment variable.');
    const openai = new OpenAI({ apiKey: serviceConfig?.apiKey, baseURL: serviceConfig?.openaiBaseUrl });

    const model = (() => {
      switch (modelType) {
        case ModelType.CHEAP:
          return serviceConfig.modelOverrides?.cheap ?? 'gpt-4o-mini';
        case ModelType.REASONING:
          return serviceConfig.modelOverrides?.reasoning ?? 'o3-mini';
        default:
          return serviceConfig.modelOverrides?.default ?? 'gpt-4o';
      }
    })();

    return internalGenerateContent(prompt, functionDefs, requiredFunctionName, temperature, modelType, model, openai);
  } catch (error) {
    if (error instanceof Error && error.message.includes('API key not configured')) {
      throw new Error('OpenAI API key not configured. Please set up the service configuration.');
    }
    throw error;
  }
};

export async function internalGenerateContent(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  modelType: ModelType = ModelType.DEFAULT,
  model: string,
  openai: OpenAI,
): Promise<FunctionCall[]> {
  const toolCalls = await internalGenerateToolCalls(
    prompt,
    functionDefs,
    requiredFunctionName,
    temperature,
    modelType,
    model,
    openai,
  );

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
}

export async function internalGenerateToolCalls(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  modelType: ModelType = ModelType.DEFAULT,
  model: string,
  openai: OpenAI,
  serviceType: AiServiceType = 'openai',
) {
  const serviceConfig = getServiceConfig('openai');

  const messages: Array<ChatCompletionMessageParam> = prompt
    .map((item) => {
      if (item.type === 'systemPrompt') {
        let systemPrompt = item.systemPrompt!;
        // Add service-specific system instructions from modelOverrides
        if (serviceConfig.modelOverrides?.systemInstruction?.length) {
          systemPrompt += `\n## ADDITIONAL INSTRUCTIONS\n\n${serviceConfig.modelOverrides.systemInstruction.join('\n')}`;
        }
        return {
          role:
            modelType === ModelType.REASONING && serviceType === 'openai'
              ? ('developer' as const)
              : ('system' as const),
          content: systemPrompt,
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
              ...(item.text
                ? [
                    {
                      type: 'text' as const,
                      text: item.text,
                    },
                  ]
                : []),
            ],
          });
        } else if (item.text) {
          messages.push({
            role: 'user' as const,
            content: item.text,
          });
        }
        return messages;
      } else {
        assert(item.type === 'assistant');
        const message: ChatCompletionMessageParam = {
          role: 'assistant' as const,
          content:
            item.text && !item.images
              ? item.text
              : ([
                  ...(item.text ? [{ type: 'text', text: item.text }] : []),
                  // Currently broken: https://github.com/openai/openai-node/issues/1030
                  ...(item.images ?? []).map((image) => ({
                    type: 'image_url' as const,
                    image_url: {
                      url: 'data:' + image.mediaType + ';base64,' + image.base64url,
                    },
                  })),
                ] as ChatCompletionContentPartText[]),
          ...(item.functionCalls && item.functionCalls.length > 0
            ? {
                tool_calls: item.functionCalls.map((call) => ({
                  type: 'function' as const,
                  function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
                  id: call.name,
                })),
              }
            : {}),
        };
        if (Array.isArray(message.content) && message.content.length === 0) {
          delete message.content;
        }
        return message;
      }
    })
    .flat();

  console.log(`Using OpenAI model: ${model}`);

  let retryCount = 0;
  const maxRetries = 3;
  let response: OpenAI.Chat.Completions.ChatCompletion | undefined = undefined;

  while (retryCount < maxRetries) {
    try {
      response = await openai.chat.completions.create(
        {
          model: model,
          messages,
          ...(functionDefs.length > 0
            ? {
                tools: functionDefs.map((funDef) => ({ type: 'function' as const, function: funDef })),
                tool_choice: requiredFunctionName
                  ? { type: 'function' as const, function: { name: requiredFunctionName } }
                  : 'required',
              }
            : {}),
          ...(modelType !== ModelType.REASONING ? { temperature } : {}),
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

  // Print token usage for openai
  const usage: TokenUsage = {
    inputTokens: response.usage!.prompt_tokens - (response.usage?.prompt_tokens_details?.cached_tokens ?? 0),
    outputTokens: response.usage!.completion_tokens,
    totalTokens: response.usage!.total_tokens,
    cacheReadTokens: response.usage?.prompt_tokens_details?.cached_tokens,
  };
  printTokenUsageAndCost({
    aiService: 'openai',
    usage,
    inputCostPerToken: 0.000005,
    outputCostPerToken: 0.000015,
    modelType,
  });

  const responseMessage = response.choices[0].message;

  if (modelType === ModelType.REASONING) {
    return [
      {
        id: 'reasoning_inference_response',
        function: {
          name: 'reasoningInferenceResponse',
          arguments: JSON.stringify({
            ...('reasoning_content' in responseMessage ? { reasoning: responseMessage.reasoning_content } : {}),
            response: responseMessage.content,
          }),
        },
      },
    ];
  }

  if (responseMessage.tool_calls) {
    return responseMessage.tool_calls;
  } else {
    throw new Error('No tool calls found in response');
  }
}
