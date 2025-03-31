import OpenAI, { APIError } from 'openai';
import assert from 'node:assert';
import { printTokenUsageAndCost, processFunctionCalls } from './common.js';
import {
  GenerateFunctionCallsArgs,
  GenerateContentArgs,
  GenerateFunctionCallsFunction,
  GenerateContentFunction,
  GenerateContentResult,
} from './common-types.js';
import { PromptItem } from './common-types.js';
import { FunctionCall } from './common-types.js';
import { TokenUsage } from './common-types.js';
import { ModelType } from './common-types.js';
import {
  ChatCompletionContentPartText,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from 'openai/resources/index';
import { abortController } from '../main/common/abort-controller.js';
import { getServiceConfig } from './service-configurations.js';
import { AiServiceType } from './service-configurations-types.js';

/**
 * This function generates content using the OpenAI chat model.
 * @deprecated Use generateContentNew instead.
 */
export const generateContent: GenerateFunctionCallsFunction = async function generateContent(
  ...args: GenerateFunctionCallsArgs
): Promise<FunctionCall[]> {
  const [prompt, functionDefs, requiredFunctionName, temperature, modelType = ModelType.DEFAULT, options] = args;

  const config: GenerateContentArgs[1] = {
    modelType,
    temperature,
    functionDefs,
    requiredFunctionName,
    expectedResponseType: { functionCall: true, text: false, media: false }, // Assuming old usage expects function calls
  };
  const opts: GenerateContentArgs[2] = {
    ...(options ?? {}),
    aiService: 'openai',
  };

  const result = await generateContentNew(prompt, config, opts);

  // Adapt the result back to FunctionCall[] for backward compatibility
  return result
    .filter((part): part is { type: 'functionCall'; functionCall: FunctionCall } => part.type === 'functionCall')
    .map((part) => part.functionCall);
};

/**
 * New function to generate content using the OpenAI chat model with a new signature.
 */
export const generateContentNew: GenerateContentFunction = async function generateContentNew(
  ...args: GenerateContentArgs
): Promise<GenerateContentResult> {
  const [prompt, config] = args;
  try {
    const serviceConfig = getServiceConfig('openai');
    assert(serviceConfig?.apiKey, 'OpenAI API key not configured, use OPENAI_API_KEY environment variable.');
    const openai = new OpenAI({ apiKey: serviceConfig?.apiKey, baseURL: serviceConfig?.openaiBaseUrl });

    const modelType = config.modelType ?? ModelType.DEFAULT;
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

    return internalGenerateContent(prompt, config, model, openai);
  } catch (error) {
    if (error instanceof Error && error.message.includes('API key not configured')) {
      throw new Error('OpenAI API key not configured. Please set up the service configuration.');
    }
    throw error;
  }
};

export async function internalGenerateContent(
  prompt: PromptItem[],
  config: GenerateContentArgs[1],
  model: string,
  openai: OpenAI,
): Promise<GenerateContentResult> {
  const toolCalls = await internalGenerateToolCalls(prompt, config, model, openai);

  const modelType = config.modelType ?? ModelType.DEFAULT;

  if (modelType === ModelType.REASONING) {
    // Reasoning models return content differently
    const reasoningResponse = toolCalls[0]; // Assuming the reasoning response is the first/only tool call
    const args = JSON.parse(reasoningResponse.function.arguments);
    const result: GenerateContentResult = [
      {
        type: 'functionCall',
        functionCall: {
          name: 'reasoningInferenceResponse',
          args: args,
        },
      },
    ];
    // If there's text content alongside reasoning, add it.
    // Note: OpenAI's current reasoning models might structure this differently.
    // This assumes the text is part of the arguments for now.
    if (args.response) {
      result.push({ type: 'text', text: args.response });
    }
    return result;
  }

  // For standard models, process tool calls
  const functionCalls = toolCalls.map((call): FunctionCall => {
    const name = call.function.name;
    let parsedArgs: Record<string, unknown> | undefined;
    try {
      parsedArgs = JSON.parse(call.function.arguments);
    } catch (e) {
      console.warn(`Failed to parse arguments for function call ${name}: ${call.function.arguments}`);
      parsedArgs = { _raw_args: call.function.arguments }; // Keep raw args if parsing fails
    }
    return {
      id: call.id,
      name,
      args: parsedArgs,
    };
  });

  // Process function calls (e.g., check for unknown functions)
  const processedCalls = processFunctionCalls(functionCalls, config.functionDefs ?? []);

  const result: GenerateContentResult = processedCalls.map((fc) => ({
    type: 'functionCall',
    functionCall: fc,
  }));

  // TODO: Handle potential text responses if expectedResponseType.text is true
  // Currently, OpenAI tool usage primarily returns tool calls, not mixed content.
  // If a text response is needed alongside function calls, the prompt/API call structure might need adjustment.

  return result;
}

async function internalGenerateToolCalls(
  prompt: PromptItem[],
  config: GenerateContentArgs[1],
  model: string,
  openai: OpenAI,
  serviceType: AiServiceType = 'openai',
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]> {
  const serviceConfig = getServiceConfig('openai');
  const modelType = config.modelType ?? ModelType.DEFAULT;
  const temperature = config.temperature ?? 0.7; // Default temperature
  const functionDefs = config.functionDefs ?? [];
  const requiredFunctionName = config.requiredFunctionName;

  const messages: Array<ChatCompletionMessageParam> = prompt
    .map((item) => {
      if (item.type === 'systemPrompt') {
        let systemPrompt = item.systemPrompt!;
        // Add service-specific system instructions from modelOverrides
        if (serviceConfig.modelOverrides?.systemInstruction?.length) {
          systemPrompt += `\n${serviceConfig.modelOverrides.systemInstruction.join('\n')}`;
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
              tool_call_id: response.call_id ?? response.name, // Use call_id if available, fallback to name
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
            item.text && !item.images && !item.functionCalls // Only text content if no images or function calls
              ? item.text
              : ([
                  // Otherwise, build content array
                  ...(item.text ? [{ type: 'text', text: item.text } as const] : []),
                  // Currently broken: https://github.com/openai/openai-node/issues/1030
                  // ...(item.images ?? []).map((image) => ({
                  //   type: 'image_url' as const,
                  //   image_url: {
                  //     url: 'data:' + image.mediaType + ';base64,' + image.base64url,
                  //   },
                  // })),
                ] as ChatCompletionContentPartText[]),
          ...(item.functionCalls && item.functionCalls.length > 0
            ? {
                // Add tool_calls if functionCalls exist
                tool_calls: item.functionCalls.map((call) => ({
                  type: 'function' as const,
                  function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
                  id: call.id ?? call.name, // Use id if available, fallback to name
                })),
              }
            : {}),
        };
        // Clean up empty content array
        if (Array.isArray(message.content) && message.content.length === 0) {
          delete message.content;
        }
        // If there's no text and no function calls, ensure content is at least null or handled
        if (!message.content && !message.tool_calls) {
          message.content = null; // Or handle as needed, maybe skip the message?
        }
        return message;
      }
    })
    .flat();

  console.log(`Using OpenAI model: ${model}`);

  let retryCount = 0;
  const maxRetries = 3;
  let response: OpenAI.Chat.Completions.ChatCompletion | undefined = undefined;

  // Determine tool choice based on function defs and required function name
  let toolChoice: ChatCompletionToolChoiceOption | undefined = undefined;
  let tools: ChatCompletionTool[] | undefined = undefined;
  if (functionDefs.length > 0) {
    tools = functionDefs.map((funDef) => ({ type: 'function' as const, function: funDef }));
    if (requiredFunctionName) {
      toolChoice = { type: 'function' as const, function: { name: requiredFunctionName } };
    } else if (config.expectedResponseType?.functionCall !== false) {
      // Require tool use unless explicitly text-only is expected
      toolChoice = 'required';
    }
  }

  while (retryCount < maxRetries) {
    try {
      response = await openai.chat.completions.create(
        {
          model: model,
          messages,
          ...(tools ? { tools } : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
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
        console.error('An error occurred during OpenAI API call:', error);
        // Throw a more specific error or handle based on error type
        if (error instanceof Error) {
          throw new Error(`API request failed: ${error.message}. Operation aborted.`);
        } else {
          throw new Error('API request failed due to an unknown error. Operation aborted.');
        }
      }
    }
  }

  if (retryCount === maxRetries) {
    console.error(`Failed to complete request after ${maxRetries} attempts due to rate limiting.`);
    throw new Error('Rate limit exceeded. Operation aborted.');
  }

  assert(response, 'API response is undefined after retries.');

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
    inputCostPerToken: 0.000005, // Example cost for gpt-4o
    outputCostPerToken: 0.000015, // Example cost for gpt-4o
    modelType,
  });

  const responseMessage = response.choices[0].message;

  if (modelType === ModelType.REASONING) {
    // Special handling for reasoning models if their response structure differs
    // Assuming the reasoning result is packed into a specific function call format
    return [
      {
        id: 'reasoning_inference_response',
        type: 'function' as const,
        function: {
          name: 'reasoningInferenceResponse',
          arguments: JSON.stringify({
            // Adapt based on actual reasoning model output structure
            ...('reasoning_content' in responseMessage ? { reasoning: responseMessage.reasoning_content } : {}),
            response: responseMessage.content,
          }),
        },
      },
    ];
  }

  if (responseMessage.tool_calls) {
    return responseMessage.tool_calls;
  } else if (config.expectedResponseType?.functionCall === false && responseMessage.content) {
    // If only text was expected and received, return empty tool calls
    // The text part will be handled in internalGenerateContent (if needed)
    return [];
  } else if (toolChoice === 'required') {
    // If tools were required but none were returned, it's an error
    console.error('Error: Tool use was required, but no tool calls were found in the response.', responseMessage);
    throw new Error('Model failed to use required tools.');
  } else {
    // No tool calls found, and they weren't strictly required
    console.warn('No tool calls found in response, though functions were provided.');
    return [];
  }
}
