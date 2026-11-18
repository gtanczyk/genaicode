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
import { acceptsTemperature } from './openai-converter.js';

type ResponsesInputItem = OpenAI.Responses.ResponseInputItem;
type ResponsesInputContent = OpenAI.Responses.ResponseInputContent;

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

function inputImage(image: NonNullable<PromptItem['images']>[number]): ResponsesInputContent {
  const url = image.url ?? `data:${image.mediaType};base64,${image.data ?? ''}`;
  return { type: 'input_image', image_url: url, detail: 'auto' };
}

/** The prompt as Responses API input items: messages, function calls and their outputs. */
export function toOpenAIResponsesInput(prompt: PromptItem[]): ResponsesInputItem[] {
  return prompt.flatMap((item): ResponsesInputItem[] => {
    if (item.type === 'systemPrompt') {
      return [{ role: 'system', content: item.systemPrompt ?? item.text ?? '' }];
    }
    if (item.type === 'assistant') {
      const items: ResponsesInputItem[] = [];
      if (item.text) items.push({ role: 'assistant', content: item.text });
      for (const call of item.toolCalls ?? []) {
        items.push({
          type: 'function_call',
          call_id: call.id ?? call.name,
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        });
      }
      return items;
    }

    const items: ResponsesInputItem[] = (item.toolResults ?? []).map((result) => ({
      type: 'function_call_output',
      call_id: result.callId ?? result.name,
      output: result.content,
    }));
    if (item.text || item.images?.length || items.length === 0) {
      const content = item.images?.length
        ? [...(item.text ? [{ type: 'input_text' as const, text: item.text }] : []), ...item.images.map(inputImage)]
        : (item.text ?? '');
      items.push({ role: 'user', content });
    }
    return items;
  });
}

export function toOpenAIResponsesTools(
  tools: ToolDefinition[] | undefined,
): OpenAI.Responses.FunctionTool[] | undefined {
  return tools?.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    // Chat completions' default: the schema guides the model but is not enforced.
    strict: false,
  }));
}

export function toOpenAIResponsesToolChoice(
  choice: ToolChoice | undefined,
): OpenAI.Responses.ResponseCreateParamsNonStreaming['tool_choice'] {
  if (!choice || typeof choice === 'string') return choice;
  return { type: 'function', name: choice.name };
}

function toOpenAIResponsesTextFormat(
  format: GenerationRequest['responseFormat'],
): OpenAI.Responses.ResponseTextConfig | undefined {
  if (!format || format.type === 'text') return undefined;
  if (format.type === 'json') return { format: { type: 'json_object' } };
  return {
    format: {
      type: 'json_schema',
      name: format.name,
      schema: format.schema as Record<string, unknown>,
      strict: format.strict,
    },
  };
}

export function toOpenAIResponsesRequest(request: GenerationRequest, defaultModel: string) {
  const model = request.model ?? defaultModel;
  return {
    model,
    input: toOpenAIResponsesInput(request.prompt),
    temperature: acceptsTemperature(model) ? request.temperature : undefined,
    max_output_tokens: request.maxOutputTokens,
    tools: toOpenAIResponsesTools(request.tools),
    tool_choice: toOpenAIResponsesToolChoice(request.toolChoice),
    text: toOpenAIResponsesTextFormat(request.responseFormat),
    // Every request carries its whole history; nothing is kept on OpenAI's side.
    store: false,
  } satisfies OpenAI.Responses.ResponseCreateParamsNonStreaming;
}

export function toOpenAIResponsesStreamRequest(request: GenerationRequest, defaultModel: string) {
  return {
    ...toOpenAIResponsesRequest(request, defaultModel),
    stream: true as const,
  } satisfies OpenAI.Responses.ResponseCreateParamsStreaming;
}

function toUsage(usage: OpenAI.Responses.ResponseUsage | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens,
  };
}

/** Chat-completions-style finish reasons, so callers see the same values on both APIs. */
function toFinishReason(response: OpenAI.Responses.Response, hasToolCalls: boolean): string | undefined {
  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason;
    return reason === 'max_output_tokens' ? 'length' : (reason ?? 'incomplete');
  }
  if (response.status === 'completed') return hasToolCalls ? 'tool_calls' : 'stop';
  return response.status ?? undefined;
}

export function fromOpenAIResponse(response: OpenAI.Responses.Response): GenerationResult {
  const parts: ResultPart[] = [];
  const text = response.output
    .flatMap((item) => (item.type === 'message' ? item.content : []))
    .map((content) => (content.type === 'output_text' ? content.text : ''))
    .join('');
  if (text) parts.push({ type: 'text', text });
  for (const item of response.output) {
    if (item.type !== 'function_call') continue;
    parts.push({
      type: 'toolCall',
      toolCall: { id: item.call_id, name: item.name, arguments: parseArguments(item.arguments) },
    });
  }
  return {
    parts,
    model: response.model,
    finishReason: toFinishReason(
      response,
      parts.some((part) => part.type === 'toolCall'),
    ),
    usage: toUsage(response.usage),
    raw: response,
  };
}

/**
 * Responses API stream events as StreamEvents: text and tool-call argument deltas as they
 * arrive, then the tool calls, usage and result of the finished response.
 */
export async function* fromOpenAIResponsesStream(
  events: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
): AsyncGenerator<StreamEvent> {
  const calls = new Map<string, { id: string; name: string }>();
  for await (const event of events) {
    switch (event.type) {
      case 'response.output_text.delta':
        if (event.delta) yield { type: 'text-delta', text: event.delta };
        break;
      case 'response.output_item.added':
        if (event.item.type === 'function_call' && event.item.id) {
          calls.set(event.item.id, { id: event.item.call_id, name: event.item.name });
        }
        break;
      case 'response.function_call_arguments.delta': {
        const call = calls.get(event.item_id);
        yield { type: 'tool-call-delta', id: call?.id, name: call?.name, argumentsDelta: event.delta };
        break;
      }
      case 'response.completed':
      case 'response.incomplete': {
        const result = fromOpenAIResponse(event.response);
        for (const part of result.parts) {
          if (part.type === 'toolCall') yield { type: 'tool-call', toolCall: part.toolCall };
        }
        if (result.usage) yield { type: 'usage', usage: result.usage };
        yield { type: 'done', result };
        return;
      }
      case 'response.failed':
        throw new Error(event.response.error?.message ?? 'OpenAI response failed');
      case 'error':
        throw new Error(event.message);
    }
  }
}
