import OpenAI, { APIError } from 'openai';
import assert from 'node:assert';
import { optimizeFunctionDefs, printTokenUsageAndCost } from './common.js';
import { GenerateContentArgs, GenerateContentFunction, GenerateContentResult } from './common-types.js';
import { PromptItem } from './common-types.js';
import { TokenUsage } from './common-types.js';
import { ModelType } from './common-types.js';
import {
  ChatCompletionContentPartText,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from 'openai/resources/index';
import { abortController } from '../main/common/abort-controller.js';
import { getServiceConfig, getModelSettings } from './service-configurations.js';
import { AiServiceType } from './service-configurations-types.js';
import { internalGenerateContentResponses } from './openai-responses.js';

/**
 * New function to generate content using the OpenAI chat model with a new signature.
 */
export const generateContent: GenerateContentFunction = async function generateContent(
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
          return serviceConfig.modelOverrides?.cheap ?? 'gpt-5.2-chat-latest';
        case ModelType.LITE:
          return serviceConfig.modelOverrides?.lite ?? 'gpt-5.1-codex-mini';
        case ModelType.REASONING:
          return serviceConfig.modelOverrides?.reasoning ?? 'gpt-5.2-pro';
        default:
          return serviceConfig.modelOverrides?.default ?? 'gpt-5.2-codex';
      }
    })();

    return internalGenerateContentResponses(prompt, config, model, openai, 'openai');
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
  serviceType: AiServiceType = 'openai',
): Promise<GenerateContentResult> {
  const modelType = config.modelType ?? ModelType.DEFAULT;
  const temperature = config.temperature ?? 0.7; // Default temperature
  const functionDefs = optimizeFunctionDefs(prompt, config.functionDefs, config.requiredFunctionName ?? undefined);
  const requiredFunctionName = config.requiredFunctionName;

  // Get model-specific settings
  const {
    systemInstruction: modelSystemInstruction,
    outputTokenLimit,
    thinkingEnabled,
    thinkingBudget,
    temperatureUnsupported,
  } = getModelSettings(serviceType, model);

  const expectedResponseType = config.expectedResponseType ?? {
    text: false,
    functionCall: true,
    media: false,
  };

  const messages: Array<ChatCompletionMessageParam> = prompt
    .map((item) => {
      if (item.type === 'systemPrompt') {
        let systemPrompt = item.systemPrompt!;

        // Add model-specific system instructions if available
        if (modelSystemInstruction?.length) {
          systemPrompt += `\n${modelSystemInstruction.join('\n')}`;
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
                  url: image.uri ? image.uri : 'data:' + image.mediaType + ';base64,' + image.base64url,
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
            item.text && !item.images && !item.functionCalls && !item.executableCode && !item.codeExecutionResult // Only text content if no images or function calls or code execution parts
              ? item.text
              : ([
                  // Otherwise, build content array
                  ...(item.text ? [{ type: 'text', text: item.text } as const] : []),
                  ...(item.executableCode
                    ? [
                        {
                          type: 'text',
                          text: `Executable Code:\n\`\`\`${item.executableCode.language}\n${item.executableCode.code}\n\`\`\``,
                        } as const,
                      ]
                    : []),
                  ...(item.codeExecutionResult
                    ? [
                        {
                          type: 'text',
                          text: `Code Execution Result (${item.codeExecutionResult.outcome}):\n\`\`\`\n${item.codeExecutionResult.output}\n\`\`\``,
                        } as const,
                      ]
                    : []),
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
    if (requiredFunctionName && expectedResponseType.functionCall !== false) {
      toolChoice = { type: 'function' as const, function: { name: requiredFunctionName } };
    } else if (expectedResponseType.functionCall !== false) {
      // Require tool use unless explicitly text-only is expected
      toolChoice = 'required';
    } else if (expectedResponseType.functionCall === false) {
      toolChoice = 'none';
    }
  }

  if (expectedResponseType.codeExecution) {
    const codeToolType = serviceType === 'openai' ? 'code_interpreter' : 'code_execution';
    tools = [
      ...(tools ?? []),
      {
        type: codeToolType,
      } as unknown as ChatCompletionTool,
    ];
    // If code execution is requested, we should allow tool use
    if (toolChoice === 'none') {
      toolChoice = undefined;
    }
  }

  let reasoningEffort: 'low' | 'medium' | 'high' | undefined = undefined;
  if (modelType === ModelType.REASONING) {
    reasoningEffort = 'high';
  } else if (typeof thinkingEnabled === 'boolean') {
    reasoningEffort =
      typeof thinkingBudget === 'number'
        ? thinkingBudget <= 1024
          ? 'low'
          : thinkingBudget <= 8192
            ? 'medium'
            : 'high'
        : 'medium';
  }

  while (retryCount < maxRetries) {
    try {
      response = await openai.chat.completions.create(
        {
          model: model,
          reasoning_effort: reasoningEffort,
          messages,
          ...(tools ? { tools } : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          ...(modelType !== ModelType.REASONING && !temperatureUnsupported ? { temperature } : {}),
          ...(outputTokenLimit && modelType !== ModelType.REASONING ? { max_tokens: outputTokenLimit } : {}),
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
    thinkingTokens: response.usage!.completion_tokens_details?.reasoning_tokens,
    outputTokens: response.usage!.completion_tokens,
    totalTokens: response.usage!.total_tokens,
    cacheReadTokens: response.usage?.prompt_tokens_details?.cached_tokens,
  };
  printTokenUsageAndCost({
    aiService: serviceType,
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
        type: 'functionCall',
        functionCall: {
          id: 'reasoning_inference_response',
          name: 'reasoningInferenceResponse',
          args: {
            // Adapt based on actual reasoning model output structure
            ...('reasoning_content' in responseMessage ? { reasoning: responseMessage.reasoning_content } : {}),
            response: responseMessage.content,
          },
        },
      },
    ];
  }

  const result: GenerateContentResult = [];

  if (responseMessage.tool_calls) {
    // Handle function calls
    if (expectedResponseType.functionCall) {
      result.push(
        ...responseMessage.tool_calls
          .filter((call) => call.type === 'function')
          .map((call) => {
            const name = call.function.name;
            let parsedArgs: Record<string, unknown> | undefined;
            try {
              parsedArgs = JSON.parse(call.function.arguments);
            } catch (e) {
              console.warn(`Failed to parse arguments for function call ${name}: ${call.function.arguments}`);
              parsedArgs = { _raw_args: call.function.arguments }; // Keep raw args if parsing fails
            }
            return {
              type: 'functionCall' as const,
              functionCall: {
                id: call.id,
                name,
                args: parsedArgs,
              },
            };
          }),
      );
    }

    // Handle code execution tool calls
    if (expectedResponseType.codeExecution) {
      const codeToolType = serviceType === 'openai' ? 'code_interpreter' : 'code_execution';

      // Actually, let's filter manually without strict type checks first
      const allToolCalls = responseMessage.tool_calls as unknown as Array<{
        type: string;
        code_interpreter?: { input: string };
        code_execution?: { input?: string; code?: string };
        function?: { name: string; arguments: string };
      }>;
      const relevantCalls = allToolCalls.filter((call) => call.type === codeToolType);

      for (const call of relevantCalls) {
        let code = '';
        let language = 'python'; // Default to python

        if (serviceType === 'openai' && call.type === 'code_interpreter') {
          code = call.code_interpreter?.input || '';
        }

        // For Grok or generic 'code_execution'
        if (serviceType !== 'openai') {
          if (call.type === 'code_execution') {
            code = call.code_execution?.input ?? call.code_execution?.code ?? '';
          } else if (call.type === 'function' && call.function?.name === 'code_execution') {
            // Fallback: sometimes it might appear as a function call
            try {
              const args = JSON.parse(call.function.arguments);
              code = args.code || args.input;
              language = args.language || 'python';
            } catch (e) {
              // ignore
            }
          }
        }

        if (code) {
          result.push({
            type: 'executableCode',
            code,
            language,
          });
        }
      }
    }
  }

  if (responseMessage.content && expectedResponseType.text) {
    result.push({
      type: 'text',
      text: responseMessage.content,
    });
  }

  if (responseMessage.content && expectedResponseType.webSearch) {
    const urls: string[] = [];
    result.push({
      type: 'webSearch',
      text: responseMessage.content,
      urls,
    });
  }

  return result;
}
