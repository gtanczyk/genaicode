import type Anthropic from '@anthropic-ai/sdk';
import type {
  Citation,
  GenerationRequest,
  GenerationResult,
  PromptImage,
  PromptItem,
  ResultPart,
  ThinkingConfig,
  ThinkingLevel,
  ToolChoice,
} from '../core/types.js';

const WEB_SEARCH_TOOL: Anthropic.WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5,
};

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

/** What a Claude model accepts, where it differs across generations. */
export interface AnthropicModelTraits {
  /** Adaptive thinking and `output_config.effort` are available. */
  adaptiveThinking: boolean;
  /** `thinking: { type: 'enabled', budget_tokens }` returns a 400. */
  rejectsBudgetTokens: boolean;
  /** A non-default `temperature` returns a 400. */
  rejectsTemperature: boolean;
  /** Forced `tool_choice` (`any` / `tool`) returns a 400. */
  rejectsForcedToolChoice: boolean;
  /**
   * How the model turns thinking off: `disabled`, `between_tools` (its lowest
   * setting), or `none` when thinking is always on and only effort lowers it.
   */
  thinkingOff: 'disabled' | 'between_tools' | 'none';
}

const LEGACY_TRAITS: AnthropicModelTraits = {
  adaptiveThinking: false,
  rejectsBudgetTokens: false,
  rejectsTemperature: false,
  rejectsForcedToolChoice: false,
  thinkingOff: 'disabled',
};

// Matches `claude-sonnet-5-5`, `anthropic.claude-opus-4-7`, `claude-opus-4-5@20251101`,
// `claude-sonnet-4-20250514`; a date is never read as a minor version.
const CLAUDE_MODEL = /claude-(opus|sonnet|haiku|fable|mythos)-(\d{1,2})(?:-(\d{1,2}))?(?!\d)/;

export function anthropicModelTraits(model: string): AnthropicModelTraits {
  const match = CLAUDE_MODEL.exec(model.toLowerCase());
  if (!match) return LEGACY_TRAITS;
  const family = match[1];
  const version = Number(match[2]) + Number(match[3] ?? 0) / 10;
  const at = (min: number) => version >= min;

  if (family === 'fable' || family === 'mythos') {
    return {
      adaptiveThinking: true,
      rejectsBudgetTokens: true,
      rejectsTemperature: true,
      rejectsForcedToolChoice: at(5.1),
      thinkingOff: 'none',
    };
  }
  if (family === 'opus' || family === 'sonnet') {
    const since = family === 'opus' ? 4.7 : 5;
    return {
      adaptiveThinking: at(4.6),
      rejectsBudgetTokens: at(since),
      rejectsTemperature: at(since),
      rejectsForcedToolChoice: at(5.5),
      thinkingOff: !at(5.5) ? 'disabled' : family === 'sonnet' ? 'between_tools' : 'none',
    };
  }
  return LEGACY_TRAITS;
}

const EFFORT_BY_LEVEL: Record<ThinkingLevel, 'low' | 'medium' | 'high'> = {
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
};

interface AnthropicThinkingParams {
  thinking?: Anthropic.ThinkingConfigParam;
  effort?: 'low' | 'medium' | 'high';
}

function toAnthropicThinking(
  thinking: ThinkingConfig | undefined,
  fallback: Anthropic.ThinkingConfigParam | undefined,
  traits: AnthropicModelTraits,
): AnthropicThinkingParams {
  if (thinking === undefined) return { thinking: fallback };
  const effort = thinking && thinking.level && traits.adaptiveThinking ? EFFORT_BY_LEVEL[thinking.level] : undefined;

  if (thinking === false || thinking.budgetTokens === 0) {
    if (traits.thinkingOff === 'none') return { effort: effort ?? 'low' };
    if (traits.thinkingOff === 'between_tools') {
      // Not in the SDK's types yet; the API takes it as-is.
      return { thinking: { type: 'between_tools' } as unknown as Anthropic.ThinkingConfigParam, effort };
    }
    return { thinking: { type: 'disabled' }, effort };
  }
  if (thinking.budgetTokens !== undefined && !traits.rejectsBudgetTokens) {
    return { thinking: { type: 'enabled', budget_tokens: thinking.budgetTokens }, effort };
  }
  if (traits.adaptiveThinking) return { thinking: { type: 'adaptive' }, effort };
  // Older models have no qualitative level; keep the provider default.
  return { thinking: fallback };
}

// Newer models 400 on forced tool use, so ask for the call in the system prompt instead.
function forcedToolInstruction(choice: ToolChoice | undefined): string | undefined {
  if (!choice || choice === 'auto' || choice === 'none') return undefined;
  if (choice === 'required') return 'Respond by calling one of the provided tools.';
  return `Respond by calling the \`${choice.name}\` tool.`;
}

export function toAnthropicRequest(
  request: GenerationRequest,
  defaults: AnthropicRequestDefaults,
): Anthropic.MessageCreateParamsNonStreaming {
  const model = request.model ?? defaults.model;
  const traits = anthropicModelTraits(model);

  // Unlike Google, Anthropic allows the web_search server tool alongside function tools.
  const tools: Anthropic.ToolUnion[] = (request.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: { ...tool.parameters, type: 'object' as const },
  }));
  if (request.search) tools.push(WEB_SEARCH_TOOL);

  const system = toAnthropicSystem(request.prompt);
  let toolChoice = request.tools?.length ? toAnthropicToolChoice(request.toolChoice) : undefined;
  const instruction = request.tools?.length ? forcedToolInstruction(request.toolChoice) : undefined;
  if (instruction && traits.rejectsForcedToolChoice) {
    toolChoice = { type: 'auto' };
    system.push({ type: 'text', text: instruction });
  }

  const { thinking, effort } = toAnthropicThinking(request.thinking, defaults.thinking, traits);

  return {
    model,
    max_tokens: request.maxOutputTokens ?? defaults.maxOutputTokens ?? 8192,
    system,
    messages: toAnthropicMessages(request.prompt),
    temperature: traits.rejectsTemperature ? undefined : request.temperature,
    tools: tools.length ? tools : undefined,
    tool_choice: toolChoice,
    thinking,
    ...(effort ? { output_config: { effort } } : {}),
  };
}

function normalizeArguments(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}

export function fromAnthropicMessage(message: Anthropic.Message): GenerationResult {
  const parts: ResultPart[] = [];
  const citations: Citation[] = [];
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
    } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      citations.push(...block.content.map((result) => ({ url: result.url, title: result.title })));
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
    ...(citations.length ? { citations } : {}),
    raw: message,
  };
}
