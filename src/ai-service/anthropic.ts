import assert from 'node:assert';
import Anthropic from '@anthropic-ai/sdk';
import { printTokenUsageAndCost, processFunctionCalls } from './common.js';
import { GenerateContentFunction } from './common-types.js';
import { PromptItem } from './common-types.js';
import { FunctionCall } from './common-types.js';
import { FunctionDef } from './common-types.js';
import { ModelType } from './common-types.js';
import { abortController } from '../main/common/abort-controller.js';
import { putSystemMessage } from '../main/common/content-bus.js';
import { getServiceConfig } from './service-configurations.js';
import { reasoningInferenceResponse } from '../prompt/function-defs/reasoning-inference.js';

/**
 * This function generates content using the Anthropic Claude model.
 */
export const generateContent: GenerateContentFunction = async function generateContent(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  modelType = ModelType.DEFAULT,
  options: { disableCache?: boolean } = {},
): Promise<FunctionCall[]> {
  try {
    const serviceConfig = getServiceConfig('anthropic');
    assert(serviceConfig?.apiKey, 'Anthropic API key not configured, use ANTHROPIC_API_KEY environment variable.');
    const anthropic = new Anthropic({
      apiKey: serviceConfig?.apiKey,
      defaultHeaders: {
        'anthropic-beta':
          'max-tokens-3-5-sonnet-2024-07-15' + (!options.disableCache ? ',prompt-caching-2024-07-31' : ''),
      },
    });

    let systemPrompt = prompt.find((item) => item.type === 'systemPrompt')?.systemPrompt || '';

    if (modelType === ModelType.REASONING) {
      // This solution mimics the behavior of a reasoning model by using a function call
      if (!functionDefs.some((f) => f.name === reasoningInferenceResponse.name)) {
        functionDefs = [...functionDefs, reasoningInferenceResponse];
      }
      requiredFunctionName = reasoningInferenceResponse.name;
      systemPrompt +=
        '\nFirst, reason step-by-step. Then, call reasoningInferenceResponse with your reasoning and answer.';
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
                source: {
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

    const defaultModel = modelType === ModelType.CHEAP ? 'claude-3-5-haiku-20241022' : 'claude-3-7-sonnet-20250219';
    const modelOverrides = serviceConfig?.modelOverrides;
    let model =
      modelType === ModelType.CHEAP
        ? (modelOverrides?.cheap ?? defaultModel)
        : modelType === ModelType.REASONING
          ? (modelOverrides?.reasoning ?? defaultModel)
          : (modelOverrides?.default ?? defaultModel);
    console.log(`Using Anthropic model: ${model}`);

    let retryCount = 0;
    let response;
    while (retryCount < 3) {
      try {
        response = await anthropic.messages.create(
          {
            model: model,
            system: systemPrompt,
            messages: messages,
            tools: functionDefs.map((fd) => ({
              name: fd.name,
              description: fd.description,
              input_schema: fd.parameters,
            })),
            tool_choice: requiredFunctionName
              ? { type: 'tool' as const, name: requiredFunctionName }
              : functionDefs.length > 0
                ? { type: 'any' as const }
                : undefined,
            max_tokens: 8192,
            temperature: temperature,
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
    if (responseMessages.length > 0) {
      console.log('Response messages', responseMessages);
    }

    const functionCalls = response!.content
      .filter((item) => item.type === 'tool_use')
      .map((item) => ({
        id: item.id,
        name: item.name,
        args: item.input as Record<string, unknown>,
      }));

    return processFunctionCalls(functionCalls, functionDefs);
  } catch (error) {
    if (error instanceof Error && error.message.includes('API key not configured')) {
      throw new Error('Anthropic API key not configured. Please set up the service configuration.');
    }
    throw error;
  }
};
