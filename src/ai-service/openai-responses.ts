import OpenAI, { APIError } from 'openai';
import assert from 'node:assert';
import { optimizeFunctionDefs, printTokenUsageAndCost } from './common.js';
import { GenerateContentArgs, GenerateContentFunction, GenerateContentResult } from './common-types.js';
import { PromptItem } from './common-types.js';
import { TokenUsage } from './common-types.js';
import { ModelType } from './common-types.js';
import { abortController } from '../main/common/abort-controller.js';
import { getServiceConfig, getModelSettings } from './service-configurations.js';
import { AiServiceType } from './service-configurations-types.js';
import { Reasoning } from 'openai/resources/shared.js';
import {
  ResponseCreateParamsBase,
  ResponseInputItem,
  ResponseItem,
  Tool,
} from 'openai/resources/responses/responses.js';

/**
 * New function to generate content using the OpenAI responses model with a new signature.
 */
export const generateContentResponses: GenerateContentFunction = async function generateContent(
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

export async function internalGenerateContentResponses(
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
    webSearch: false,
    codeExecution: false,
  };

  const messages: Array<ResponseInputItem> = prompt
    .map((item, idx) => {
      if (item.type === 'systemPrompt') {
        let systemPrompt = item.systemPrompt!;

        // Add model-specific system instructions if available
        if (modelSystemInstruction?.length) {
          systemPrompt += `\n${modelSystemInstruction.join('\n')}`;
        }

        return {
          role: 'system' as const,
          content: systemPrompt,
        };
      } else if (item.type === 'user') {
        const messages: ResponseItem[] = [];
        if (item.functionResponses) {
          messages.push(
            ...item.functionResponses.map((response, fridx) => ({
              type: 'function_call_output' as const,
              output: response.content ?? '',
              id: `fc_${idx}_${fridx}`,
              call_id: response.call_id ?? response.name, // Use call_id if available, fallback to name
            })),
          );
        }
        if ((item.images?.length ?? 0) > 0) {
          messages.push({
            id: `msg_${idx}`,
            role: 'user' as const,
            content: [
              ...item.images!.map((image) => ({
                type: 'input_image' as const,
                detail: 'auto' as const,
                image_url: image.uri ? image.uri : 'data:' + image.mediaType + ';base64,' + image.base64url,
              })),
              ...(item.text
                ? [
                    {
                      type: 'input_text' as const,
                      text: item.text,
                    },
                  ]
                : []),
            ],
          });
        } else if (item.text) {
          messages.push({
            id: `msg_${idx}`,
            role: 'user' as const,
            content: [
              {
                type: 'input_text' as const,
                text: item.text,
              },
            ],
          });
        }
        return messages;
      } else {
        assert(item.type === 'assistant');
        const messages: ResponseItem[] = [];
        if (item.text) {
          // Only text content if no images or function calls
          messages.push({
            id: `msg_${idx}`,
            role: 'assistant',
            status: 'completed',
            type: 'message',
            content: [{ type: 'output_text', text: item.text, annotations: [] }],
          });
        }
        if (item.functionCalls && item.functionCalls.length > 0) {
          messages.push(
            ...item.functionCalls.map((call, fxidx) => ({
              id: `fc_${idx}_${fxidx}`,
              type: 'function_call' as const,
              call_id: call.id ?? call.name,
              name: call.name,
              arguments: JSON.stringify(call.args ?? {}),
            })),
          );
        }
        return messages;
      }
    })
    .flat();

  console.log(`Using OpenAI Responses model: ${model}`);

  let retryCount = 0;
  const maxRetries = 3;
  let response: OpenAI.Responses.Response | undefined = undefined;

  // Determine tool choice based on function defs and required function name
  let toolChoice: ResponseCreateParamsBase['tool_choice'] | undefined = undefined;
  const tools: Tool[] = [];

  if (functionDefs.length > 0) {
    tools.push(
      ...functionDefs.map((funDef) => ({
        type: 'function' as const,
        name: funDef.name,
        description: funDef.description,
        parameters: { additionalProperties: false, ...funDef.parameters },
        strict: false,
      })),
    );
    if (requiredFunctionName && expectedResponseType.functionCall !== false) {
      toolChoice = { type: 'function' as const, name: requiredFunctionName };
    } else if (expectedResponseType.functionCall !== false) {
      // Require tool use unless explicitly text-only is expected
      toolChoice = 'required';
    } else if (expectedResponseType.functionCall === false) {
      toolChoice = 'none';
    }
  }

  if (expectedResponseType.webSearch) {
    tools.push({ type: 'web_search' });
  }

  if (expectedResponseType.codeExecution) {
    const codeInterpreterTool: Extract<Tool, { type: 'code_interpreter' }> = {
      type: 'code_interpreter',
      container: {
        type: 'auto',
        ...(config.fileIds && config.fileIds.length > 0 ? { file_ids: config.fileIds } : {}),
      },
    };

    tools.push(codeInterpreterTool);
  }

  // For now, image generation will be a tool that can be called.
  // The actual image generation logic will be handled by a separate service/function.
  if (expectedResponseType.media) {
    // In the future, we might add an ImageGenerationTool here.
  }

  let reasoning: Reasoning | undefined = undefined;
  if (typeof thinkingEnabled === 'boolean') {
    reasoning = {
      effort:
        typeof thinkingBudget === 'number'
          ? thinkingBudget <= 1024
            ? 'low'
            : thinkingBudget <= 8192
              ? 'medium'
              : 'high'
          : 'medium',
    };
  }

  while (retryCount < maxRetries) {
    try {
      // Assuming openai.responses.create exists and has a similar signature
      response = await openai.responses.create(
        {
          model: model,
          reasoning: reasoning,
          input: messages,
          ...(tools.length > 0 ? { tools } : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          ...(!temperatureUnsupported ? { temperature } : {}),
          ...(outputTokenLimit ? { max_tokens: outputTokenLimit } : {}),
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
    inputTokens: response.usage!.input_tokens,
    outputTokens: response.usage!.output_tokens,
    totalTokens: response.usage!.total_tokens,
  };
  printTokenUsageAndCost({
    aiService: serviceType,
    usage,
    inputCostPerToken: 0.000005, // Example cost for gpt-4o
    outputCostPerToken: 0.000015, // Example cost for gpt-4o
    modelType,
  });

  const responseMessage = response.output;
  const result: GenerateContentResult = [];

  if (responseMessage.some((msg) => msg.type === 'function_call') && expectedResponseType.functionCall) {
    result.push(
      ...responseMessage
        .filter((msg) => msg.type === 'function_call')
        .map((call) => {
          const name = call.name;
          let parsedArgs: Record<string, unknown> | undefined;
          try {
            parsedArgs = JSON.parse(call.arguments);
          } catch (e) {
            console.warn(`Failed to parse arguments for function call ${name}: ${call.arguments}`);
            parsedArgs = { _raw_args: call.arguments }; // Keep raw args if parsing fails
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

  // Handle code execution results
  if (expectedResponseType.codeExecution) {
    const codeInterpreterCalls = responseMessage.filter((msg) => msg.type === 'code_interpreter_call') as Extract<
      ResponseItem,
      { type: 'code_interpreter_call' }
    >[];

    for (const call of codeInterpreterCalls) {
      const inputCode = call.code;
      if (inputCode) {
        result.push({
          type: 'executableCode',
          code: inputCode,
          language: 'python', // Default for code interpreter
        });
      }

      const outputs = call.outputs || [];
      let logs = '';
      const outputFiles: Array<{ fileId: string; filename: string; size: number; mimeType: string }> = [];

      for (const output of outputs) {
        if (output.type === 'logs') {
          logs += output.logs + '\n';
        } else if (output.type === 'image') {
          // The SDK defines image output as having a 'url' property, not 'file_id'
          // We will use the URL as the fileId for now, or extract it if it's a file path
          const fileId = output.url;

          if (fileId) {
            outputFiles.push({
              fileId: fileId,
              filename: `generated_image.png`, // We don't have the original filename
              size: 0, // Unknown size
              mimeType: 'image/png',
            });
            logs += `[Generated Image: ${fileId}]\n`;
          }
        }
      }

      if (logs || outputFiles.length > 0) {
        result.push({
          type: 'codeExecutionResult',
          outcome: 'OUTCOME_OK',
          output: logs,
          outputFiles: outputFiles.length > 0 ? outputFiles : undefined,
        });
      }
    }
  }

  for (const part of responseMessage
    .filter((msg) => msg.type === 'message')
    .flatMap((msg) => msg.content)
    .filter((p) => p.type === 'output_text')) {
    if (expectedResponseType.webSearch === true) {
      result.push({
        type: 'webSearch',
        text: part.text,
        urls: part.annotations.filter((a) => a.type === 'url_citation').map((a) => a.url),
      });
    } else {
      result.push({
        type: 'text',
        text: part.text,
      });
    }
  }

  return result;
}
