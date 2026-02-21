import assert from 'node:assert';
import Anthropic from '@anthropic-ai/sdk';
import { optimizeFunctionDefs, printTokenUsageAndCost } from './common.js';
import { GenerateContentFunction, GenerateContentResult, PromptItem } from './common-types.js';
import { FunctionDef } from './common-types.js';
import { ModelType } from './common-types.js';
import { abortController } from '../main/common/abort-controller.js';
import { putSystemMessage } from '../main/common/content-bus.js';
import { getServiceConfig, getModelSettings } from './service-configurations.js';
import { WebSearchToolResultBlock } from '@anthropic-ai/sdk/resources/messages.js';
import { BetaBashCodeExecutionResultBlock, BetaServerToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages.js';

/**
 * This function generates content using the Anthropic Claude model.
 */
export const generateContent: GenerateContentFunction = async function generateContent(
  prompt: PromptItem[],
  config: {
    modelType?: ModelType;
    temperature?: number;
    functionDefs?: FunctionDef[];
    requiredFunctionName?: string | null;
    expectedResponseType?: {
      text?: boolean;
      functionCall?: boolean;
      media?: boolean;
      webSearch?: boolean;
      codeExecution?: boolean;
    };
    fileIds?: string[];
    uploadedFiles?: Array<{
      fileId: string;
      filename: string;
      originalPath: string;
    }>;
  },
  options: {
    geminiBlockNone?: boolean;
    disableCache?: boolean;
    aiService?: string;
    askQuestion?: boolean;
  } = {},
): Promise<GenerateContentResult> {
  const modelType = config.modelType ?? ModelType.DEFAULT;
  const temperature = config.temperature ?? 0.7;
  let functionDefs = optimizeFunctionDefs(prompt, config.functionDefs, config.requiredFunctionName ?? undefined);
  let requiredFunctionName = config.requiredFunctionName ?? null;
  const expectedResponseType = config.expectedResponseType ?? { text: false, functionCall: true, media: false };

  try {
    const serviceConfig = getServiceConfig('anthropic');
    assert(serviceConfig?.apiKey, 'Anthropic API key not configured, use ANTHROPIC_API_KEY environment variable.');

    let betaHeaders = 'max-tokens-3-5-sonnet-2024-07-15' + (!options.disableCache ? ',prompt-caching-2024-07-31' : '');

    if (expectedResponseType.codeExecution) {
      betaHeaders += ',code-execution-2025-08-25';
    }

    const anthropic = new Anthropic({
      apiKey: serviceConfig?.apiKey,
      defaultHeaders: {
        'anthropic-beta': betaHeaders,
      },
    });

    // Get base system prompt
    let baseSystemPrompt = prompt.find((item) => item.type === 'systemPrompt')?.systemPrompt || '';

    // Determine which model to use
    const defaultModel =
      modelType === ModelType.CHEAP || modelType === ModelType.LITE ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';
    const modelOverrides = serviceConfig?.modelOverrides;
    let model =
      modelType === ModelType.CHEAP
        ? (modelOverrides?.cheap ?? defaultModel)
        : modelType === ModelType.LITE
          ? (modelOverrides?.lite ?? defaultModel)
          : modelType === ModelType.REASONING
            ? (modelOverrides?.reasoning ?? defaultModel)
            : (modelOverrides?.default ?? defaultModel);

    // Get model-specific settings
    const {
      systemInstruction: modelSystemInstruction,
      outputTokenLimit,
      thinkingEnabled,
      thinkingBudget,
    } = getModelSettings('anthropic', model);

    // Combine base system prompt with model-specific instructions if available
    if (modelSystemInstruction?.length) {
      baseSystemPrompt += `\n${modelSystemInstruction.join('\n')}`;
    }

    if (modelType === ModelType.REASONING) {
      functionDefs = [];
      requiredFunctionName = null;
    }

    let cacheControlCount = prompt.filter((item) => item.cache).length;
    const messages: Anthropic.MessageParam[] = prompt
      .filter((item) => item.type !== 'systemPrompt')
      .map((item) => {
        if (item.type === 'user') {
          const content: Array<
            | Anthropic.TextBlockParam
            | Anthropic.ImageBlockParam
            | Anthropic.ToolUseBlockParam
            | Anthropic.ToolResultBlockParam
          > = [];
          if (item.functionResponses) {
            content.push(
              ...(item.functionResponses ?? []).map((response) => ({
                tool_use_id: response.call_id ?? response.name,
                content: response.content,
                type: 'tool_result' as const,
                is_error: response.isError === true,
              })),
            );
          }

          if (item.images) {
            content.push(
              ...(item.images ?? []).map((image) => ({
                type: 'image' as const,
                source: image.uri
                  ? {
                      type: 'url' as const,
                      url: image.uri,
                    }
                  : {
                      type: 'base64' as const,
                      media_type: image.mediaType,
                      data: image.base64url,
                    },
              })),
            );
          }

          if (item.text) {
            content.push({
              type: 'text' as const,
              text: item.text,
            });
          }

          const shouldAddCache = item.cache && !options.disableCache && cacheControlCount-- < 4;
          if (shouldAddCache) {
            content.slice(-1)[0].cache_control = { type: 'ephemeral' as const };
          }
          const message: Anthropic.MessageParam = {
            role: 'user',
            content,
          };
          return message;
        } else {
          assert(item.type === 'assistant');
          const content: Array<
            | Anthropic.TextBlockParam
            | Anthropic.ImageBlockParam
            | Anthropic.ToolUseBlockParam
            | Anthropic.ToolResultBlockParam
          > = [
            ...(item.text ? [{ type: 'text' as const, text: item.text }] : []),
            ...(item.functionCalls ?? []).map((call) => ({
              id: call.id ?? call.name,
              name: call.name,
              input: call.args ?? {},
              type: 'tool_use' as const,
            })),
            ...(item.executableCode
              ? [
                  {
                    type: 'text' as const,
                    text: `Executable Code:\n\`\`\`${item.executableCode.language}\n${item.executableCode.code}\n\`\`\``,
                  },
                ]
              : []),
            ...(item.codeExecutionResult
              ? [
                  {
                    type: 'text' as const,
                    text: `Code Execution Result (${item.codeExecutionResult.outcome}):\n\`\`\`\n${item.codeExecutionResult.output}\n\`\`\``,
                  },
                ]
              : []),
          ];

          if (item.images) {
            content.push(
              ...(item.images ?? []).map((image) => ({
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: image.mediaType,
                  data: image.base64url,
                },
              })),
            );
          }

          const message: Anthropic.MessageParam = {
            role: 'assistant' as const,
            content,
          };
          return message;
        }
      });

    console.log(`Using Anthropic model: ${model}`);

    let retryCount = 0;
    let response;

    // Set max_tokens based on model-specific setting or defaults
    const maxTokens = outputTokenLimit ?? (modelType === ModelType.REASONING ? 8192 * 2 : 8192);

    let tools: Anthropic.Messages.ToolUnion[] | undefined = undefined;
    if (expectedResponseType.functionCall !== false) {
      tools = [
        ...(tools ?? []),
        ...functionDefs.map((fd) => ({
          name: fd.name,
          description: fd.description,
          input_schema: fd.parameters,
        })),
      ];
    }
    if (expectedResponseType.webSearch) {
      tools = [
        ...(tools ?? []),
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 5,
        },
      ];
    }
    if (expectedResponseType.codeExecution) {
      tools = [
        ...(tools ?? []),
        {
          type: 'code_execution_20250825',
          name: 'bash_code_execution',
        } as unknown as Anthropic.Messages.ToolUnion,
      ];
    }

    while (retryCount < 3) {
      try {
        response = await anthropic.messages.create(
          {
            model: model,
            system: baseSystemPrompt,
            messages: messages,
            tools: tools,
            tool_choice:
              requiredFunctionName && modelType !== ModelType.REASONING
                ? { type: 'tool' as const, name: requiredFunctionName }
                : functionDefs.length > 0 &&
                    modelType !== ModelType.REASONING &&
                    expectedResponseType.functionCall !== false
                  ? { type: 'any' as const }
                  : undefined,
            max_tokens: maxTokens,
            temperature: modelType !== ModelType.REASONING ? temperature : 1,
            thinking:
              thinkingEnabled && thinkingBudget
                ? {
                    type: 'enabled',
                    budget_tokens: thinkingBudget,
                  }
                : modelType === ModelType.REASONING
                  ? {
                      type: 'enabled',
                      budget_tokens: 8192,
                    }
                  : undefined,
          },
          {
            signal: abortController?.signal,
          },
        );
        break; // Exit loop if successful
      } catch (error) {
        // Check for vision capability error
        if (
          error instanceof Anthropic.APIError &&
          error.status === 400 &&
          error.message?.includes('does not support image input')
        ) {
          // If using haiku, fallback to sonnet for vision
          if (model.includes('haiku')) {
            putSystemMessage('Model does not support vision features. Falling back to claude-3-5-sonnet-20241022...');
            model = 'claude-3-5-sonnet-20241022';
            // Don't increment retry count for vision fallback
            continue;
          } else {
            // If already using sonnet or other model, propagate the error
            console.error('Vision features not supported by the model and fallback failed:', error);
            throw new Error('Vision features not supported by any available model. Operation aborted.');
          }
        }

        // Handle rate limiting
        if (error instanceof Anthropic.APIError && error.headers?.['retry-after']) {
          let retryAfter: number;
          if (error.headers['retry-after'] === '0') {
            retryAfter = (new Date(error.headers['anthropic-ratelimit-tokens-reset']!).getTime() - Date.now()) / 1000;
          } else {
            retryAfter = Math.max(parseInt(error.headers['retry-after'], 10), 10);
          }
          retryAfter = Math.min(retryAfter, 30);
          putSystemMessage(`Rate limited. Retrying after ${retryAfter} seconds. Attempt ${retryCount + 1} of 3.`);
          await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
          retryCount++;
        } else {
          console.error('An error occurred:', error);
          throw new Error('API request failed. Operation aborted.');
        }
      }
    }

    if (retryCount === 3) {
      console.error('Failed to complete request after 3 attempts due to rate limiting.');
      throw new Error('Rate limit exceeded. Operation aborted.');
    }

    // Print token usage for Anthropic
    const usage = {
      cacheCreateTokens: response!.usage.cache_creation_input_tokens,
      cacheReadTokens: response!.usage.cache_read_input_tokens,
      inputTokens: response!.usage.input_tokens,
      outputTokens: response!.usage.output_tokens,
      totalTokens:
        response!.usage.input_tokens +
        response!.usage.output_tokens +
        (response!.usage.cache_creation_input_tokens ?? 0) +
        (response!.usage.cache_read_input_tokens ?? 0),
    };
    printTokenUsageAndCost({
      aiService: 'anthropic',
      usage,
      inputCostPerToken: 3 / 1000 / 1000,
      outputCostPerToken: 15 / 1000 / 1000,
      modelType,
    });

    const responseMessages = response!.content.filter((item) => item.type !== 'tool_use');

    if (modelType === ModelType.REASONING) {
      const thinking = responseMessages.find((item) => item.type === 'thinking')?.thinking;
      const responseMessage = responseMessages.find((item) => item.type === 'text')?.text;

      return [
        {
          type: 'functionCall',
          functionCall: {
            id: 'reasoning_inference_response',
            name: 'reasoningInferenceResponse',
            args: {
              ...(thinking ? { reasoning: thinking } : {}),
              response: responseMessage,
            },
          },
        },
      ];
    }

    const result: GenerateContentResult = [];

    const functionCalls = response!.content
      .filter((item) => item.type === 'tool_use')
      .map((item) => ({
        id: item.id,
        name: item.name,
        args: item.input as Record<string, unknown>,
      }));

    if (expectedResponseType.functionCall) {
      for (const fc of functionCalls) {
        // Filter out code execution tool calls from standard function calls
        if (fc.name === 'bash_code_execution') continue;

        result.push({
          type: 'functionCall',
          functionCall: fc,
        });
      }
    }

    if (expectedResponseType.codeExecution) {
      // Cast to a union type including beta content blocks instead of any[]
      const content = response?.content as (
        | Anthropic.ContentBlock
        | BetaServerToolUseBlock
        | BetaBashCodeExecutionResultBlock
      )[];

      const codeInput = content
        .filter(
          (item): item is BetaServerToolUseBlock =>
            item.type === 'server_tool_use' && item.name === 'bash_code_execution',
        )
        .reverse()[0]?.input;

      const code =
        typeof codeInput === 'object' && codeInput !== null && 'command' in codeInput
          ? (codeInput as { command: string }).command
          : (codeInput as string);

      const execResult = content
        .filter((item): item is BetaBashCodeExecutionResultBlock => item.type === 'bash_code_execution_result')
        .reverse()[0]?.stdout;

      if (code) {
        result.push({
          type: 'executableCode',
          code,
          language: 'bash',
        });
      }
      if (execResult) {
        result.push({
          type: 'codeExecutionResult',
          outcome: 'OUTCOME_OK',
          output: execResult,
        });
      }
    }

    if (expectedResponseType.webSearch) {
      const urls = responseMessages
        .filter((item): item is WebSearchToolResultBlock => item.type === 'web_search_tool_result')
        .map((item) => item.content)
        .filter((content) => Array.isArray(content))
        .flatMap((content) => content.filter((item) => item.type === 'web_search_result'))
        .map((item) => item.url);
      const text = responseMessages
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('');
      if (text) {
        result.push({
          type: 'webSearch',
          text,
          urls,
        });
      }
    } else if (expectedResponseType.text) {
      for (const item of responseMessages.filter((itm) => itm.type === 'text')) {
        result.push({
          type: 'text',
          text: item.text,
        });
      }
    }

    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes('API key not configured')) {
      throw new Error('Anthropic API key not configured. Please set up the service configuration.');
    }
    throw error;
  }
};
