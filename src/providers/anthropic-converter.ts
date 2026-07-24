import type Anthropic from '@anthropic-ai/sdk';
import type {
  GenerationRequest,
  GenerationResult,
  PromptImage,
  PromptItem,
  ResultPart,
  ToolChoice,
} from '../core/types.js';

function toAnthropicImage(image: PromptImage): Anthropic.ImageBlockParam {
  return {
    type: 'image',
    source: image.url
      ? { type: 'url', url: image.url }
      : { type: 'base64', media_type: image.mediaType, data: image.data ?? '' },
  };
}

function withCache<T extends Anthropic.ContentBlockParam>(block: T, cache: boolean | undefined): T {
  return cache ? { ...block, cache_control: { type: 'ephemeral' } } : block;
}

export function toAnthropicSystem(prompt: PromptItem[]): Anthropic.TextBlockParam[] {
  return prompt
    .filter((item) => item.type === 'systemPrompt')
    .map((item) => withCache({ type: 'text', text: item.systemPrompt ?? item.text ?? '' }, item.cache));
}

export function toAnthropicMessages(prompt: PromptItem[]): Anthropic.MessageParam[] {
  return prompt
    .filter((item) => item.type !== 'systemPrompt')
    .map((item): Anthropic.MessageParam => {
      const content: Anthropic.ContentBlockParam[] = [];

      if (item.type === 'user') {
        content.push(
          ...(item.toolResults ?? []).map(
            (result): Anthropic.ToolResultBlockParam => ({
              type: 'tool_result',
              tool_use_id: result.callId ?? result.name,
              content: result.content,
              is_error: result.isError,
            }),
          ),
          ...(item.images ?? []).map(toAnthropicImage),
        );
      }

      if (item.text) content.push({ type: 'text', text: item.text });

      if (item.type === 'assistant') {
        content.push(
          ...(item.toolCalls ?? []).map(
            (call): Anthropic.ToolUseBlockParam => ({
              type: 'tool_use',
              id: call.id ?? call.name,
              name: call.name,
              input: call.arguments,
            }),
          ),
        );
      }

      if (content.length === 0) content.push({ type: 'text', text: '' });
      if (item.cache) content[content.length - 1] = withCache(content[content.length - 1], true);
      return { role: item.type === 'assistant' ? 'assistant' : 'user', content };
    });
}

export function toAnthropicToolChoice(choice: ToolChoice | undefined): Anthropic.ToolChoice | undefined {
  if (!choice || choice === 'auto') return { type: 'auto' };
  if (choice === 'none') return { type: 'none' };
  if (choice === 'required') return { type: 'any' };
  return { type: 'tool', name: choice.name };
}

export interface AnthropicRequestDefaults {
  model: string;
  maxOutputTokens?: number;
  thinking?: Anthropic.ThinkingConfigParam;
}

export function toAnthropicRequest(
  request: GenerationRequest,
  defaults: AnthropicRequestDefaults,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: request.model ?? defaults.model,
    max_tokens: request.maxOutputTokens ?? defaults.maxOutputTokens ?? 8192,
    system: toAnthropicSystem(request.prompt),
    messages: toAnthropicMessages(request.prompt),
    temperature: request.temperature,
    tools: request.tools?.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: { ...tool.parameters, type: 'object' as const },
    })),
    tool_choice: request.tools?.length ? toAnthropicToolChoice(request.toolChoice) : undefined,
    thinking: defaults.thinking,
  };
}

function normalizeArguments(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}

export function fromAnthropicMessage(message: Anthropic.Message): GenerationResult {
  const parts: ResultPart[] = [];
  for (const block of message.content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'tool_use') {
      parts.push({
        type: 'toolCall',
        toolCall: {
          id: block.id,
          name: block.name,
          arguments: normalizeArguments(block.input),
        },
      });
    }
  }

  const cacheTokens = message.usage.cache_read_input_tokens ?? 0;
  return {
    parts,
    model: message.model,
    finishReason: message.stop_reason ?? undefined,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      totalTokens:
        message.usage.input_tokens +
        message.usage.output_tokens +
        (message.usage.cache_creation_input_tokens ?? 0) +
        cacheTokens,
      cachedInputTokens: cacheTokens,
    },
    raw: message,
  };
}
