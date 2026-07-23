import {
  FunctionCallingConfigMode,
  type Content,
  type GenerateContentConfig,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
} from '@google/genai';
import type {
  GenerationRequest,
  GenerationResult,
  PromptImage,
  PromptItem,
  ResultPart,
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

export function toGoogleRequest(
  request: GenerationRequest,
  defaults: GoogleRequestDefaults,
): GenerateContentParameters {
  const hasTools = Boolean(request.tools?.length);
  return {
    model: request.model ?? defaults.model,
    contents: toGoogleContents(request.prompt),
    config: {
      ...defaults.config,
      abortSignal: request.signal,
      systemInstruction: toGoogleSystemInstruction(request.prompt),
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
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
    raw: response,
  };
}
