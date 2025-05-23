import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import assert from 'node:assert';
import { printTokenUsageAndCost } from './common.js';
import {
  GenerateContentFunction,
  GenerateContentResult,
  GenerateContentResultPart,
  PromptItem,
  FunctionDef,
  ModelType,
} from './common-types.js';
import { Message, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { abortController } from '../main/common/abort-controller.js';
import { getServiceConfig, getModelSettings } from './service-configurations.js';
import { reasoningInferenceResponse } from '../prompt/function-defs/reasoning-inference.js';

/**
 * This function generates content using the Anthropic Claude model via Vertex AI with the new interface.
 */
export const generateContent: GenerateContentFunction = async function generateContent(
  prompt: PromptItem[],
  config: {
    modelType?: ModelType;
    temperature?: number;
    functionDefs?: FunctionDef[];
    requiredFunctionName?: string | null;
    expectedResponseType?: {
      text: boolean;
      functionCall: boolean;
      media: boolean; // Note: Claude doesn't generate media
    };
  },
): Promise<GenerateContentResult> {
  const modelType = config.modelType ?? ModelType.DEFAULT;
  const temperature = config.temperature ?? 0.7;
  let functionDefs = config.functionDefs ?? [];
  let requiredFunctionName = config.requiredFunctionName ?? null;
  const expectedResponseType = config.expectedResponseType ?? { text: true, functionCall: true, media: false };

  const serviceConfig = getServiceConfig('vertex-ai-claude');
  assert(serviceConfig.googleCloudProjectId, 'googleCloudProjectId is not set in the service configuration');
  assert(serviceConfig.googleCloudRegion, 'googleCloudRegion is not set in the service configuration');

  const client: AnthropicVertex = new AnthropicVertex({
    projectId: serviceConfig.googleCloudProjectId,
    region: serviceConfig.googleCloudRegion,
  });

  // Get base system prompt
  let baseSystemPrompt = prompt.find((item) => item.type === 'systemPrompt')?.systemPrompt || '';

  // Determine the model name based on model type
  const model = (() => {
    switch (modelType) {
      case ModelType.CHEAP:
        return serviceConfig.modelOverrides?.cheap ?? 'claude-3-haiku@20240307';
      case ModelType.REASONING:
        return serviceConfig.modelOverrides?.reasoning ?? 'claude-3-5-sonnet@20240620';
      default:
        return serviceConfig.modelOverrides?.default ?? 'claude-3-5-sonnet@20240620';
    }
  })();

  console.log(`Using Vertex AI Claude model: ${model}`);

  // Get model-specific settings
  const { systemInstruction: modelSystemInstruction, outputTokenLimit } = getModelSettings('vertex-ai-claude', model);

  // Add model-specific system instructions if available
  if (modelSystemInstruction?.length) {
    baseSystemPrompt += `\n${modelSystemInstruction.join('\n')}`;
  }

  // Reasoning model emulation via function calling
  if (modelType === ModelType.REASONING) {
    if (!functionDefs.some((f) => f.name === reasoningInferenceResponse.name)) {
      functionDefs = [...functionDefs, reasoningInferenceResponse];
    }
    requiredFunctionName = reasoningInferenceResponse.name;
    baseSystemPrompt +=
      '\nFirst, reason step-by-step. Then, call reasoningInferenceResponse with your reasoning and answer.';
  }

  const messages: MessageParam[] = prompt
    .filter((item) => item.type !== 'systemPrompt')
    .map((item) => {
      if (item.type === 'user') {
        return {
          role: 'user' as const,
          content: [
            ...(item.functionResponses ?? []).map((response) => ({
              type: 'tool_result' as const,
              tool_use_id: response.call_id ?? response.name, // Use call_id if available
              content: response.content,
              is_error: response.isError === true,
            })),
            ...(item.images ?? []).map((image) => ({
              type: 'image' as const,
              source: image.uri
                ? { type: 'url' as const, url: image.uri }
                : {
                    type: 'base64' as const,
                    media_type: image.mediaType,
                    data: image.base64url,
                  },
            })),
            ...(item.text ? [{ type: 'text' as const, text: item.text ?? '' }] : []),
          ],
        };
      } else if (item.type === 'assistant') {
        return {
          role: 'assistant' as const,
          content: [
            ...(item.text ? [{ type: 'text' as const, text: item.text }] : []),
            ...(item.functionCalls ?? []).map((call) => ({
              type: 'tool_use' as const,
              id: call.id ?? call.name, // Use id if available
              name: call.name,
              input: call.args ?? {},
            })),
          ],
        };
      }
    })
    .filter((message) => !!message);

  const tools = functionDefs.map((fd) => ({
    name: fd.name,
    description: fd.description,
    input_schema: fd.parameters,
  }));

  const toolChoice = (() => {
    if (!expectedResponseType.functionCall) {
      // To prevent function calling, we can try omitting tools/tool_choice or use auto/any.
      // Let's stick with 'auto' as omitting tools might error if the model tries to call one.
      return { type: 'auto' as const };
    }
    if (requiredFunctionName) {
      return { type: 'tool' as const, name: requiredFunctionName };
    }
    return { type: 'any' as const }; // Allow any tool if function calls expected but none specific required
  })();

  // Use the model-specific outputTokenLimit or fall back to default (4096)
  const maxTokens = outputTokenLimit ?? 4096;

  const response: Message = await client.messages.create(
    {
      model: model,
      max_tokens: maxTokens,
      temperature: temperature,
      system: baseSystemPrompt,
      messages: messages,
      ...(tools.length > 0 ? { tools } : {}), // Only include tools if defined
      ...(tools.length > 0 ? { tool_choice: toolChoice } : {}), // Only include tool_choice if tools are defined
    },
    { signal: abortController?.signal },
  );

  // Print token usage for Anthropic Vertex AI
  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
  };
  printTokenUsageAndCost({
    aiService: 'vertex-ai-claude',
    usage,
    inputCostPerToken: modelType === ModelType.CHEAP ? 0.25 / 1000 / 1000 : 3 / 1000 / 1000, // Haiku vs Sonnet
    outputCostPerToken: modelType === ModelType.CHEAP ? 1.25 / 1000 / 1000 : 15 / 1000 / 1000, // Haiku vs Sonnet
    modelType,
  });

  const resultParts: GenerateContentResultPart[] = [];

  for (const item of response.content) {
    if (item.type === 'text' && expectedResponseType.text) {
      resultParts.push({ type: 'text', text: item.text });
    } else if (item.type === 'tool_use' && expectedResponseType.functionCall) {
      resultParts.push({
        type: 'functionCall',
        functionCall: {
          id: item.id, // Preserve the ID for potential use in subsequent tool_result
          name: item.name,
          args: item.input as Record<string, unknown>,
        },
      });
    }
  }

  // Log unexpected text response if only function call was expected
  if (
    response.content.some((item) => item.type === 'text') &&
    !expectedResponseType.text &&
    expectedResponseType.functionCall
  ) {
    console.log(
      'Unexpected text response when only function call was expected:',
      response.content.filter((item) => item.type === 'text'),
    );
  }

  return resultParts;
};
