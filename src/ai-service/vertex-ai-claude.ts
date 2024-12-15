import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import assert from 'node:assert';
import { printTokenUsageAndCost, processFunctionCalls, FunctionCall, PromptItem, FunctionDef } from './common.js';
import { Message, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { abortController } from '../main/interactive/codegen-worker.js';
import { getServiceConfig } from './service-configurations.js';

/**
 * This function generates content using the Anthropic Claude model via Vertex AI.
 */
export async function generateContent(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  cheap = false,
): Promise<FunctionCall[]> {
  const serviceConfig = getServiceConfig('vertex-ai-claude');
  assert(serviceConfig.googleCloudProjectId, 'googleCloudProjectId is not set in the service configuration');
  assert(serviceConfig.googleCloudRegion, 'googleCloudRegion is not set in the service configuration');

  const client: AnthropicVertex = new AnthropicVertex({
    projectId: serviceConfig.googleCloudProjectId,
    region: serviceConfig.googleCloudRegion,
  });

  const messages: MessageParam[] = prompt
    .filter((item) => item.type !== 'systemPrompt')
    .map((item) => {
      if (item.type === 'user') {
        return {
          role: 'user' as const,
          content: [
            ...(item.functionResponses ?? []).map((response) => ({
              type: 'tool_result' as const,
              tool_use_id: response.call_id ?? response.name,
              content: response.content,
              is_error: response.isError === true,
            })),
            ...(item.images ?? []).map((image) => ({
              type: 'image' as const,
              source: {
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
              id: call.id ?? call.name,
              name: call.name,
              input: call.args ?? {},
            })),
          ],
        };
      }
    })
    .filter((message) => !!message);

  const model = cheap
    ? (serviceConfig.modelOverrides?.cheap ?? 'claude-3-5-haiku@20240620')
    : (serviceConfig.modelOverrides?.default ?? 'claude-3-5-sonnet@20240620');
  console.log(`Using Vertex AI Claude model: ${model}`);

  const response: Message = await client.messages.create(
    {
      model: model,
      max_tokens: cheap ? 4096 : 8192,
      temperature: temperature,
      system: prompt.find((item) => item.type === 'systemPrompt')!.systemPrompt!,
      messages: messages,
      tools: functionDefs.map((fd) => ({
        name: fd.name,
        description: fd.description,
        input_schema: fd.parameters,
      })),
      tool_choice: requiredFunctionName
        ? { type: 'tool' as const, name: requiredFunctionName }
        : { type: 'any' as const },
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
    inputCostPerToken: 3 / 1000 / 1000,
    outputCostPerToken: 15 / 1000 / 1000,
    cheap,
  });

  const responseMessages = response.content.filter((item) => item.type !== 'tool_use');
  if (responseMessages.length > 0) {
    console.log('Response messages', responseMessages);
  }

  const functionCalls = response.content
    .filter((item) => item.type === 'tool_use')
    .map((item) => ({
      id: item.id,
      name: item.name,
      args: item.input as Record<string, unknown>,
    }));

  return processFunctionCalls(functionCalls, functionDefs);
}
