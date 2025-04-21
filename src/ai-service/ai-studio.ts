import {
  Content,
  FunctionCallingConfigMode,
  FunctionDeclaration,
  GenerateContentParameters,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  Schema,
} from '@google/genai';
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
import { getServiceConfig, getModelSettings } from './service-configurations.js';

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
  const expectedResponseType = config.expectedResponseType ?? {
    text: false,
    functionCall: true,
    media: false,
  };

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

  const req: GenerateContentParameters = {
    contents: messages,
    config: {},
  };

  if (functionDefs.length > 0) {
    req.config!.tools = [
      {
        functionDeclarations: functionDefs as unknown as FunctionDeclaration[],
      },
    ];
  }
  if (expectedResponseType.functionCall !== false) {
    req.config!.toolConfig = {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.ANY,
        ...(requiredFunctionName ? { allowedFunctionNames: [requiredFunctionName] } : {}),
      },
    };
  } else if (expectedResponseType.functionCall === false) {
    req.config!.toolConfig = {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.NONE,
        allowedFunctionNames: [],
      },
    };
  }

  const result = await modelGenerateContent(
    modelType,
    temperature,
    prompt.find((item) => item.type === 'systemPrompt')?.systemPrompt,
    options.geminiBlockNone,
    req,
  );

  // Print token usage
  const usageMetadata = result.usageMetadata!;
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

  if (result.promptFeedback) {
    console.log('Prompt feedback:');
    console.log(JSON.stringify(result.promptFeedback, null, 2));
  }

  if (!result.candidates?.length) {
    console.log('Response:', result);
    throw new Error('No candidates found');
  }

  const functionCalls = result.candidates
    .map((candidate) => candidate.content?.parts?.map((part) => part.functionCall))
    .flat()
    .filter((functionCall): functionCall is NonNullable<typeof functionCall> => !!functionCall)
    .map((call) => ({
      name: call.name!,
      args: call.args as Record<string, unknown>,
    }))
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
    if (result.candidates[0].content?.parts?.length === 2) {
      resultParts.push({
        type: 'text',
        text: result.candidates[0].content?.parts.slice(-2)[0].text ?? '',
      });
    }

    // Add the response text
    resultParts.push({
      type: 'text',
      text: result.candidates[0].content?.parts?.slice(-1)[0].text ?? '',
    });

    // Add the special function call for reasoning inference response
    resultParts.push({
      type: 'functionCall',
      functionCall: {
        name: 'reasoningInferenceResponse',
        args: {
          reasoning:
            result.candidates[0].content?.parts?.length === 2
              ? result.candidates[0].content?.parts.slice(-2)[0].text
              : undefined,
          response: result.candidates[0].content?.parts?.slice(-1)[0].text,
        },
      },
    });
  }

  // Handle text response if no function calls were returned
  if (functionCalls.length === 0) {
    const textResponse =
      result.candidates
        .map((candidate) => candidate.content?.parts?.map((part) => part.text))
        .flat()
        .filter((text): text is string => !!text)[0] ??
      result.candidates.map((candidate) =>
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

function modelGenerateContent(
  modelType: ModelType,
  temperature: number,
  systemPrompt: string | undefined,
  geminiBlockNone: boolean | undefined,
  { contents, config }: Pick<GenerateContentParameters, 'contents' | 'config'>,
) {
  const serviceConfig = getServiceConfig('ai-studio');
  assert(serviceConfig.apiKey, 'API key not configured, use API_KEY environment variable');
  const genAI = new GoogleGenAI({ apiKey: serviceConfig.apiKey });

  // Determine the model name based on model type
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

  // Get model-specific settings
  const { systemInstruction: modelSystemInstruction, outputTokenLimit } = getModelSettings('ai-studio', model);

  // Combine base system prompt with model-specific instructions if available
  let effectiveSystemPrompt = systemPrompt || '';
  if (modelSystemInstruction?.length) {
    effectiveSystemPrompt += `\n${modelSystemInstruction.join('\n')}`;
  }

  return genAI.models.generateContent({
    model,
    config: {
      httpOptions: {
        abortSignal: abortController?.signal,
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
      ...Object.assign(
        {
          maxOutputTokens: outputTokenLimit,
          temperature,
          topP: 0.95,
        },
        config,
      ),
      ...(effectiveSystemPrompt
        ? {
            systemInstruction: {
              role: 'system',
              parts: [
                {
                  text: effectiveSystemPrompt,
                },
              ],
            },
          }
        : {}),
    },
    contents,
  });
}

async function recoverFunctionCall(
  textResponse: string,
  functionCalls: FunctionCall[],
  functionDef: FunctionDef,
): Promise<Record<string, unknown> | false> {
  console.log('Recovering function call');
  const schema: Schema = functionDef.parameters as unknown as Schema;
  const result = await modelGenerateContent(
    ModelType.DEFAULT, // Always use default model for recovery attempts
    0.2,
    'Your role is read the text below and if possible, return it in the desired format.',
    undefined,
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
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    },
  );

  try {
    const parsed = JSON.parse(result.text!);
    const functionCall = enableVertexUnescape
      ? unescapeFunctionCall({ name: functionDef.name, args: parsed })
      : { name: functionDef.name, args: parsed };

    functionCalls.push(functionCall);
    return parsed;
  } catch {
    return false;
  }
}
