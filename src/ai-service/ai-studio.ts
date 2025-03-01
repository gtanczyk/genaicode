import {
  Content,
  FunctionCallingMode,
  FunctionDeclaration,
  GenerateContentRequest,
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  ResponseSchema,
} from '@google/generative-ai';
import assert from 'node:assert';
import { printTokenUsageAndCost, processFunctionCalls } from './common.js';
import { GenerateContentFunction } from './common-types.js';
import { PromptItem } from './common-types.js';
import { FunctionCall } from './common-types.js';
import { FunctionDef } from './common-types.js';
import { ModelType } from './common-types.js';
import { abortController } from '../main/common/abort-controller.js';
import { unescapeFunctionCall } from './unescape-function-call.js';
import { enableVertexUnescape } from '../cli/cli-params.js';
import { getServiceConfig } from './service-configurations.js';

/**
 * This function generates content using the Anthropic Claude model via Vertex AI.
 */
export const generateContent: GenerateContentFunction = async function generateContent(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  modelType: ModelType = ModelType.DEFAULT,
  options: { geminiBlockNone?: boolean } = {},
): Promise<FunctionCall[]> {
  const messages: Content[] = prompt
    .filter((item) => item.type === 'user' || item.type === 'assistant')
    .map((item) => {
      if (item.type === 'user') {
        const content: Content = {
          role: 'user' as const,
          parts: [
            ...(item.functionResponses ?? []).map((response) => ({
              functionResponse: {
                name: response.name,
                response: { name: response.name, content: response.content },
              },
            })),
            ...(item.images ?? []).map((image) => ({
              inlineData: {
                mimeType: image.mediaType,
                data: image.base64url,
              },
            })),
            ...(item.text ? [{ text: item.text }] : []),
          ],
        };
        return content;
      } else {
        assert(item.type === 'assistant');
        const content: Content = {
          role: 'model' as const,
          parts: [
            ...(item.text ? [{ text: item.text }] : []),
            ...(item.images ?? []).map((image) => ({
              inlineData: {
                mimeType: image.mediaType,
                data: image.base64url,
              },
            })),
            ...(item.functionCalls ?? []).map((call) => ({
              functionCall: {
                name: call.name,
                args: call.args ?? {},
              },
            })),
          ],
        };
        return content;
      }
    });

  const req: GenerateContentRequest = {
    contents: messages,
  };

  if (functionDefs.length > 0) {
    req.tools = [
      {
        functionDeclarations: functionDefs as unknown as FunctionDeclaration[],
      },
    ];
    req.toolConfig = {
      functionCallingConfig: {
        mode: FunctionCallingMode.ANY,
        ...(requiredFunctionName ? { allowedFunctionNames: [requiredFunctionName] } : {}),
      },
    };
  }

  const model = getModel(
    modelType,
    temperature,
    prompt.find((item) => item.type === 'systemPrompt')?.systemPrompt,
    options.geminiBlockNone,
  );

  const result = await model.generateContent(req, { signal: abortController?.signal });

  // Print token usage
  const usageMetadata = result.response.usageMetadata!;
  const usage = {
    inputTokens: usageMetadata.promptTokenCount,
    outputTokens: usageMetadata.candidatesTokenCount,
    totalTokens: usageMetadata.totalTokenCount,
  };
  printTokenUsageAndCost({
    aiService: 'ai-studio',
    usage,
    inputCostPerToken: 0.000125 / 1000,
    outputCostPerToken: 0.000375 / 1000,
    modelType,
  });

  if (result.response.promptFeedback) {
    console.log('Prompt feedback:');
    console.log(JSON.stringify(result.response.promptFeedback, null, 2));
  }

  if (!result.response.candidates?.length) {
    console.log('Response:', result);
    throw new Error('No candidates found');
  }

  const functionCalls = result.response.candidates
    .map((candidate) => candidate.content?.parts?.map((part) => part.functionCall))
    .flat()
    .filter((functionCall): functionCall is NonNullable<typeof functionCall> => !!functionCall)
    .map((call) => ({ name: call.name, args: call.args as Record<string, unknown> }))
    .map(!enableVertexUnescape ? (call) => call : unescapeFunctionCall);

  if (modelType === ModelType.REASONING) {
    functionCalls.push({
      name: 'reasoningInferenceResponse',
      args: {
        reasoning:
          result.response.candidates[0].content?.parts.length === 2
            ? result.response.candidates[0].content?.parts.slice(-2)[0].text
            : undefined,
        response: result.response.candidates[0].content?.parts.slice(-1)[0].text,
      },
    });
  }

  if (functionCalls.length === 0) {
    const textResponse =
      result.response.candidates
        .map((candidate) => candidate.content?.parts?.map((part) => part.text))
        .flat()
        .filter((text): text is string => !!text)[0] ??
      result.response.candidates.map((candidate) =>
        // @ts-expect-error: FinishReason type does not have this error
        candidate.finishReason === 'MALFORMED_FUNCTION_CALL' ? candidate.finishMessage : '',
      )[0];

    const recoveredFunctionCall =
      textResponse &&
      (await recoverFunctionCall(
        textResponse,
        functionCalls,
        functionDefs.find((def) => def.name === requiredFunctionName)!,
      ));
    if (!recoveredFunctionCall) {
      console.log('No function calls, output text response if it exists:', textResponse);
    } else {
      console.log('Recovered function call.');
    }
  }

  return processFunctionCalls(functionCalls, functionDefs);
};

function getModel(
  modelType: ModelType,
  temperature: number,
  systemPrompt: string | undefined,
  geminiBlockNone: boolean | undefined,
) {
  const serviceConfig = getServiceConfig('ai-studio');
  assert(serviceConfig.apiKey, 'API key not configured, use API_KEY environment variable');
  const genAI = new GoogleGenerativeAI(serviceConfig.apiKey);

  const model = (() => {
    switch (modelType) {
      case ModelType.CHEAP:
        return serviceConfig.modelOverrides?.cheap ?? 'gemini-2.0-flash';
      case ModelType.REASONING:
        return serviceConfig.modelOverrides?.reasoning ?? 'gemini-2.0-flash-thinking-exp-01-21';
      default:
        return serviceConfig.modelOverrides?.default ?? 'gemini-1.5-pro-002';
    }
  })();

  console.log(`Using AI Studio model: ${model}`);

  return genAI.getGenerativeModel({
    model,
    generationConfig: {
      maxOutputTokens: 8192,
      temperature,
      topP: 0.95,
    },
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: geminiBlockNone ? HarmBlockThreshold.BLOCK_NONE : HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: geminiBlockNone ? HarmBlockThreshold.BLOCK_NONE : HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: geminiBlockNone ? HarmBlockThreshold.BLOCK_NONE : HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: geminiBlockNone ? HarmBlockThreshold.BLOCK_NONE : HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
      },
    ],
    ...(systemPrompt
      ? {
          systemInstruction: {
            role: 'system',
            parts: [
              {
                text: systemPrompt,
              },
            ],
          },
        }
      : {}),
  });
}

async function recoverFunctionCall(
  textResponse: string,
  functionCalls: FunctionCall[],
  functionDef: FunctionDef,
): Promise<boolean> {
  console.log('Recovering function call');
  // @ts-expect-error: "object" !== "OBJECT"
  const schema: ResponseSchema = functionDef.parameters;
  const result = await getModel(
    ModelType.DEFAULT, // Always use default model for recovery attempts
    0.2,
    'Your role is read the text below and if possible, return it in the desired format.',
    undefined,
  ).generateContent(
    {
      contents: [
        {
          role: 'user' as const,
          parts: [
            {
              text: textResponse,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    },
    {
      signal: abortController?.signal,
    },
  );

  try {
    const parsed = JSON.parse(result.response.text());
    functionCalls.push(
      enableVertexUnescape
        ? unescapeFunctionCall({ name: functionDef.name, args: parsed })
        : { name: functionDef.name, args: parsed },
    );
    return true;
  } catch {
    return false;
  }
}
