import type OpenAI from 'openai';
import type {
  GenerationRequest,
  GenerationResult,
  PromptItem,
  ResultPart,
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

export function toOpenAIRequest(request: GenerationRequest, defaultModel: string) {
  return {
    model: request.model ?? defaultModel,
    messages: toOpenAIMessages(request.prompt),
    temperature: request.temperature,
    max_completion_tokens: request.maxOutputTokens,
    tools: toOpenAITools(request.tools),
    tool_choice: toOpenAIToolChoice(request.toolChoice),
  } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
}
