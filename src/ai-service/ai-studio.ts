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
import { printTokenUsageAndCost } from './common.js';
import { GenerateContentFunction, GenerateContentResult, GenerateContentResultPart } from './common-types.js';
import { PromptItem } from './common-types.js';
import { FunctionCall } from './common-types.js';
import { FunctionDef } from './common-types.js';
import { ModelType } from './common-types.js';
import { abortController } from '../main/common/abort-controller.js';
import { unescapeFunctionCall } from './unescape-function-call.js';
import { enableVertexUnescape } from '../cli/cli-params.js';
import { getServiceConfig } from './service-configurations.js';

/**
 * This function generates content using the Google AI Studio models with the new interface.
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
      media: boolean;
    };
  },
  options: {
    geminiBlockNone?: boolean;
    disableCache?: boolean;
    aiService?: string;
    askQuestion?: boolean;
  } = {},
): Promise<GenerateContentResult> {
  const modelType = config.modelType ?? ModelType.DEFAULT;
  const temperature = config.temperature ?? 0.7;
  const functionDefs = config.functionDefs ?? [];
  const requiredFunctionName = config.requiredFunctionName ?? null;
  const expectedResponseType = config.expectedResponseType ?? { text: true, functionCall: true, media: true };

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
  }
  if (expectedResponseType.functionCall !== false) {
    req.toolConfig = {
      functionCallingConfig: {
        mode: FunctionCallingMode.ANY,
        ...(requiredFunctionName ? { allowedFunctionNames: [requiredFunctionName] } : {}),
      },
    };
  } else {
    req.toolConfig = {
      functionCallingConfig: {
        mode: FunctionCallingMode.NONE,
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

  // Prepare the result parts array
  const resultParts: GenerateContentResultPart[] = [];

  // Add function calls to result parts if they exist
  if (functionCalls.length > 0) {
    functionCalls.forEach((call) => {
      resultParts.push({
        type: 'functionCall',
        functionCall: call,
      });
    });
  }

  // Handle reasoning model special case
  if (modelType === ModelType.REASONING) {
    // Add the reasoning text if available
    if (result.response.candidates[0].content?.parts.length === 2) {
      resultParts.push({
        type: 'text',
        text: result.response.candidates[0].content?.parts.slice(-2)[0].text ?? '',
      });
    }

    // Add the response text
    resultParts.push({
      type: 'text',
      text: result.response.candidates[0].content?.parts.slice(-1)[0].text ?? '',
    });

    // Add the special function call for reasoning inference response
    resultParts.push({
      type: 'functionCall',
      functionCall: {
        name: 'reasoningInferenceResponse',
        args: {
          reasoning:
            result.response.candidates[0].content?.parts.length === 2
              ? result.response.candidates[0].content?.parts.slice(-2)[0].text
              : undefined,
          response: result.response.candidates[0].content?.parts.slice(-1)[0].text,
        },
      },
    });
  }

  // Handle text response if no function calls were returned
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

    if (textResponse) {
      resultParts.push({
        type: 'text',
        text: textResponse,
      });

      // Try to recover function call from text if required function name is provided
      const functionDef = functionDefs.find((def) => def.name === requiredFunctionName);
      if (functionDef) {
        try {
          const recoveredCall = await recoverFunctionCall(textResponse, [], functionDef);
          if (recoveredCall) {
            console.log('Recovered function call.');
            // The recovered call will be added to the functionCalls array by the recoverFunctionCall function
            // We need to add it to resultParts as well
            resultParts.push({
              type: 'functionCall',
              functionCall: {
                name: functionDef.name,
                args: recoveredCall,
              },
            });
          }
        } catch (error) {
          console.log('Failed to recover function call:', error);
        }
      }
    }
  }

  return resultParts;
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

  // Add service-specific system instructions from modelOverrides
  if (serviceConfig.modelOverrides?.systemInstruction?.length) {
    systemPrompt += `\n${serviceConfig.modelOverrides.systemInstruction.join('\n')}`;
  }

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
): Promise<Record<string, unknown> | false> {
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
    const functionCall = enableVertexUnescape
      ? unescapeFunctionCall({ name: functionDef.name, args: parsed })
      : { name: functionDef.name, args: parsed };

    functionCalls.push(functionCall);
    return parsed;
  } catch {
    return false;
  }
}
