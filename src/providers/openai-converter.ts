import type OpenAI from 'openai';
import type {
  GenerationRequest,
  GenerationResult,
  PromptItem,
  ResultPart,
  StreamEvent,
  TokenUsage,
  ToolChoice,
  ToolDefinition,
} from '../core/types.js';

type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { $raw: value };
  }
}

function imagePart(
  image: NonNullable<PromptItem['images']>[number],
): OpenAI.Chat.Completions.ChatCompletionContentPart {
  const url = image.url ?? `data:${image.mediaType};base64,${image.data ?? ''}`;
  return { type: 'image_url', image_url: { url } };
}

export function toOpenAIMessages(prompt: PromptItem[]): OpenAIMessage[] {
  return prompt.flatMap((item): OpenAIMessage[] => {
    if (item.type === 'systemPrompt') {
      return [{ role: 'system', content: item.systemPrompt ?? item.text ?? '' }];
    }
    if (item.type === 'assistant') {
      return [
        {
          role: 'assistant',
          content: item.text ?? null,
          ...(item.toolCalls?.length
            ? {
                tool_calls: item.toolCalls.map((call) => ({
                  type: 'function' as const,
                  id: call.id ?? call.name,
                  function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                })),
              }
            : {}),
        },
      ];
    }

    const messages: OpenAIMessage[] = (item.toolResults ?? []).map((result) => ({
      role: 'tool',
      tool_call_id: result.callId ?? result.name,
      content: result.content,
    }));
    if (item.text || item.images?.length || messages.length === 0) {
      const content = item.images?.length
        ? [...(item.text ? [{ type: 'text' as const, text: item.text }] : []), ...item.images.map(imagePart)]
        : (item.text ?? '');
      messages.push({ role: 'user', content });
    }
    return messages;
  });
}

export function toOpenAITools(
  tools: ToolDefinition[] | undefined,
): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
  return tools?.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function toOpenAIToolChoice(
  choice: ToolChoice | undefined,
): OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined {
  if (!choice || typeof choice === 'string') return choice;
  return { type: 'function', function: { name: choice.name } };
}

export function fromOpenAICompletion(completion: OpenAI.Chat.Completions.ChatCompletion): GenerationResult {
  const choice = completion.choices[0];
  const parts: ResultPart[] = [];
  if (choice?.message.content) {
    parts.push({ type: 'text', text: choice.message.content });
  }
  for (const call of choice?.message.tool_calls ?? []) {
    if (call.type !== 'function') continue;
    parts.push({
      type: 'toolCall',
      toolCall: {
        id: call.id,
        name: call.function.name,
        arguments: parseArguments(call.function.arguments),
      },
    });
  }
  return {
    parts,
    model: completion.model,
    finishReason: choice?.finish_reason ?? undefined,
    usage: completion.usage
      ? {
          inputTokens: completion.usage.prompt_tokens,
          outputTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
          cachedInputTokens: completion.usage.prompt_tokens_details?.cached_tokens,
        }
      : undefined,
    raw: completion,
  };
}

function toOpenAIResponseFormat(
  format: GenerationRequest['responseFormat'],
): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming['response_format'] | undefined {
  if (!format || format.type === 'text') return undefined;
  if (format.type === 'json') {
    return { type: 'json_object' };
  }
  return {
    type: 'json_schema',
    json_schema: {
      name: format.name,
      schema: format.schema,
      strict: format.strict,
    },
  };
}

export function toOpenAIRequest(request: GenerationRequest, defaultModel: string) {
  return {
    model: request.model ?? defaultModel,
    messages: toOpenAIMessages(request.prompt),
    temperature: request.temperature,
    max_completion_tokens: request.maxOutputTokens,
    tools: toOpenAITools(request.tools),
    tool_choice: toOpenAIToolChoice(request.toolChoice),
    response_format: toOpenAIResponseFormat(request.responseFormat),
  } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
}

export function toOpenAIStreamRequest(request: GenerationRequest, defaultModel: string) {
  return {
    ...toOpenAIRequest(request, defaultModel),
    stream: true as const,
    stream_options: { include_usage: true },
  } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
}

/**
 * Accumulate OpenAI chat completion chunks into StreamEvents.
 * Tool-call argument fragments are emitted as `tool-call-delta` and finalized on `done`.
 */
export async function* fromOpenAIStream(
  chunks: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
): AsyncGenerator<StreamEvent> {
  let text = '';
  const toolCalls = new Map<number, { id?: string; name?: string; arguments: string }>();
  let model: string | undefined;
  let finishReason: string | undefined;
  let usage: TokenUsage | undefined;
  let raw: OpenAI.Chat.Completions.ChatCompletionChunk | undefined;

  for await (const chunk of chunks) {
    raw = chunk;
    model = chunk.model ?? model;
    if (chunk.usage) {
      usage = {
        inputTokens: chunk.usage.prompt_tokens,
        outputTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens,
        cachedInputTokens: chunk.usage.prompt_tokens_details?.cached_tokens,
      };
      yield { type: 'usage', usage };
    }

    const choice = chunk.choices[0];
    if (!choice) continue;
    finishReason = choice.finish_reason ?? finishReason;

    const delta = choice.delta;
    if (delta.content) {
      text += delta.content;
      yield { type: 'text-delta', text: delta.content };
    }

    for (const call of delta.tool_calls ?? []) {
      const current = toolCalls.get(call.index) ?? { arguments: '' };
      if (call.id) current.id = call.id;
      if (call.function?.name) current.name = call.function.name;
      if (call.function?.arguments) {
        current.arguments += call.function.arguments;
        yield {
          type: 'tool-call-delta',
          id: current.id,
          name: current.name,
          argumentsDelta: call.function.arguments,
        };
      }
      toolCalls.set(call.index, current);
    }
  }

  const parts: ResultPart[] = [];
  if (text) parts.push({ type: 'text', text });

  for (const call of toolCalls.values()) {
    if (!call.name) continue;
    const toolCall = {
      id: call.id,
      name: call.name,
      arguments: parseArguments(call.arguments),
    };
    parts.push({ type: 'toolCall', toolCall });
    yield { type: 'tool-call', toolCall };
  }

  yield {
    type: 'done',
    result: {
      parts,
      model,
      finishReason: finishReason ?? undefined,
      usage,
      raw,
    },
  };
}
