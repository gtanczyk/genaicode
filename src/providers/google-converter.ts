import {
  FunctionCallingConfigMode,
  ThinkingLevel,
  type Content,
  type GenerateContentConfig,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
} from '@google/genai';
import type {
  Citation,
  GenerationRequest,
  GenerationResult,
  PromptImage,
  PromptItem,
  ResponseFormat,
  ResultPart,
  ThinkingConfig,
  ToolChoice,
} from '../core/types.js';

function parseToolResult(content: string, isError: boolean | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    const value =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { value: parsed };
    return isError ? { error: value } : value;
  } catch {
    return isError ? { error: content } : { output: content };
  }
}

function toGoogleImage(image: PromptImage): Part {
  return image.url
    ? { fileData: { fileUri: image.url, mimeType: image.mediaType } }
    : { inlineData: { data: image.data ?? '', mimeType: image.mediaType } };
}

export function toGoogleSystemInstruction(prompt: PromptItem[]): Content | undefined {
  const parts = prompt
    .filter((item) => item.type === 'systemPrompt')
    .map((item) => ({ text: item.systemPrompt ?? item.text ?? '' }));
  return parts.length ? { parts } : undefined;
}

export function toGoogleContents(prompt: PromptItem[]): Content[] {
  return prompt
    .filter((item) => item.type !== 'systemPrompt')
    .map((item): Content => {
      const parts: Part[] = [];
      if (item.type === 'user') {
        parts.push(
          ...(item.toolResults ?? []).map((result) => ({
            functionResponse: {
              id: result.callId ?? result.name,
              name: result.name,
              response: parseToolResult(result.content, result.isError),
            },
          })),
          ...(item.images ?? []).map(toGoogleImage),
        );
      }
      if (item.text) parts.push({ text: item.text });
      if (item.type === 'assistant') {
        parts.push(
          ...(item.toolCalls ?? []).map((call) => ({
            functionCall: { id: call.id ?? call.name, name: call.name, args: call.arguments },
          })),
        );
      }
      if (parts.length === 0) parts.push({ text: '' });
      return { role: item.type === 'assistant' ? 'model' : 'user', parts };
    });
}

function toGoogleToolConfig(choice: ToolChoice | undefined): GenerateContentConfig['toolConfig'] {
  if (!choice || choice === 'auto') {
    return { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } };
  }
  if (choice === 'none') {
    return { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } };
  }
  if (choice === 'required') {
    return { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } };
  }
  return {
    functionCallingConfig: {
      mode: FunctionCallingConfigMode.ANY,
      allowedFunctionNames: [choice.name],
    },
  };
}

export interface GoogleRequestDefaults {
  model: string;
  config?: Omit<
    GenerateContentConfig,
    'abortSignal' | 'systemInstruction' | 'temperature' | 'maxOutputTokens' | 'tools' | 'toolConfig'
  >;
}

function toGoogleResponseFormat(format: ResponseFormat | undefined): Partial<GenerateContentConfig> {
  if (!format || format.type === 'text') return {};
  if (format.type === 'json') {
    return { responseMimeType: 'application/json' };
  }
  return {
    responseMimeType: 'application/json',
    responseJsonSchema: format.schema,
  };
}

const googleThinkingLevels = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
} as const;

function defaultDisabledThinkingLevel(model: string | undefined): ThinkingLevel {
  if (!model) return ThinkingLevel.MINIMAL;
  const normalized = model.toLowerCase();
  // Gemini 3.7 models and Gemini 3+ Pro models do not support MINIMAL (their floor is LOW).
  if (/gemini-3\.7/i.test(normalized) || /gemini-3(?:\.[0-9]+)?-pro/i.test(normalized)) {
    return ThinkingLevel.LOW;
  }
  return ThinkingLevel.MINIMAL;
}

function toGoogleThinkingConfig(
  thinking: ThinkingConfig | undefined,
  fallback: GenerateContentConfig['thinkingConfig'] | undefined,
  wantsJson: boolean,
  model: string | undefined,
): GenerateContentConfig['thinkingConfig'] {
  if (thinking === false || thinking?.budgetTokens === 0) {
    // Gemini 3 rejects `thinkingBudget: 0` (INVALID_ARGUMENT). `MINIMAL` is the
    // supported "keep it cheap / effectively off" setting for models that support it,
    // while models like Gemini 3.7 and Gemini 3 Pro floor at `LOW`.
    return { thinkingLevel: defaultDisabledThinkingLevel(model) };
  }
  if (thinking?.level) {
    return { thinkingLevel: googleThinkingLevels[thinking.level] };
  }
  if (thinking?.budgetTokens !== undefined) {
    return { thinkingBudget: thinking.budgetTokens };
  }
  if (fallback !== undefined) {
    return fallback;
  }
  if (wantsJson) {
    // Gemini 3 defaults to heavy dynamic thinking; with a small maxOutputTokens budget that
    // can yield an empty visible answer under JSON mode. Prefer MINIMAL (or LOW on models that
    // floor at LOW) when neither the caller nor the provider set thinking explicitly.
    return { thinkingLevel: defaultDisabledThinkingLevel(model) };
  }
  return undefined;
}

export function toGoogleRequest(
  request: GenerationRequest,
  defaults: GoogleRequestDefaults,
): GenerateContentParameters {
  const model = request.model ?? defaults.model;
  const hasTools = Boolean(request.tools?.length);
  const responseFormat = toGoogleResponseFormat(request.responseFormat);
  const wantsJson = request.responseFormat?.type === 'json' || request.responseFormat?.type === 'json_schema';
  const thinkingConfig = toGoogleThinkingConfig(request.thinking, defaults.config?.thinkingConfig, wantsJson, model);
  return {
    model,
    contents: toGoogleContents(request.prompt),
    config: {
      ...defaults.config,
      ...responseFormat,
      ...(thinkingConfig !== undefined ? { thinkingConfig } : {}),
      abortSignal: request.signal,
      systemInstruction: toGoogleSystemInstruction(request.prompt),
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      // Function tools and googleSearch grounding are mutually exclusive on this API —
      // function tools win, matching toolChoice below applying only to them.
      tools: hasTools
        ? [
            {
              functionDeclarations: request.tools?.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parametersJsonSchema: tool.parameters,
              })),
            },
          ]
        : request.search
          ? [{ googleSearch: {} }]
          : undefined,
      toolConfig: hasTools ? toGoogleToolConfig(request.toolChoice) : undefined,
    },
  };
}

export function fromGoogleResponse(response: GenerateContentResponse): GenerationResult {
  const candidate = response.candidates?.[0];
  const parts: ResultPart[] = [];

  for (const part of candidate?.content?.parts ?? []) {
    if (part.text && !part.thought) {
      parts.push({ type: 'text', text: part.text });
    }
    if (part.functionCall?.name) {
      parts.push({
        type: 'toolCall',
        toolCall: {
          id: part.functionCall.id,
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {},
        },
      });
    }
    const mediaType = part.inlineData?.mimeType;
    if (
      (mediaType === 'image/jpeg' ||
        mediaType === 'image/png' ||
        mediaType === 'image/gif' ||
        mediaType === 'image/webp') &&
      part.inlineData?.data
    ) {
      parts.push({
        type: 'image',
        image: {
          mediaType,
          data: part.inlineData.data,
        },
      });
    }
  }

  const usage = response.usageMetadata;
  const citations: Citation[] = [];
  for (const chunk of candidate?.groundingMetadata?.groundingChunks ?? []) {
    if (chunk.web?.uri) citations.push({ url: chunk.web.uri, ...(chunk.web.title ? { title: chunk.web.title } : {}) });
  }

  return {
    parts,
    model: response.modelVersion,
    finishReason: candidate?.finishReason,
    usage: usage
      ? {
          inputTokens: usage.promptTokenCount,
          outputTokens: usage.candidatesTokenCount,
          totalTokens: usage.totalTokenCount,
          cachedInputTokens: usage.cachedContentTokenCount,
        }
      : undefined,
    ...(citations.length ? { citations } : {}),
    raw: response,
  };
}
