import {
  Blob,
  Content,
  FileData,
  FunctionCallingConfigMode,
  FunctionDeclaration,
  GenerateContentParameters,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  Language,
  Schema,
  Outcome,
} from '@google/genai';
import axios from 'axios';
import assert from 'node:assert';
import mime from 'mime-types';
import { optimizeFunctionDefs, printTokenUsageAndCost } from './common.js';
import {
  GenerateContentFunction,
  GenerateContentResult,
  GenerateContentResultPart,
  PromptItem,
  FunctionCall,
  FunctionDef,
  ModelType,
  GenerateContentArgs,
} from './common-types.js';
import { abortController } from '../main/common/abort-controller.js';

import { unescapeFunctionCall } from './unescape-function-call.js';
import { enableVertexUnescape } from '../cli/cli-params.js';
import { getServiceConfig, getModelSettings } from './service-configurations.js';

/**
 * This function generates content using the Google AI Studio models with the new interface.
 */
export const generateContent: GenerateContentFunction = async function generateContent(
  ...args: GenerateContentArgs
): Promise<GenerateContentResult> {
  const [prompt, config, options = {}] = args;
  return internalGoogleGenerateContent('ai-studio', prompt, config, options);
};

export async function internalGoogleGenerateContent(
  serviceType: 'ai-studio' | 'vertex-ai',
  prompt: PromptItem[],
  config: GenerateContentArgs[1],
  options: GenerateContentArgs[2] = {},
): Promise<GenerateContentResult> {
  const modelType = config.modelType ?? ModelType.DEFAULT;
  const temperature = config.temperature ?? 0.7;
  const functionDefs = optimizeFunctionDefs(prompt, config.functionDefs, config.requiredFunctionName ?? undefined);
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
            ...(item.images ?? []).map((image) =>
              image.uri
                ? {
                    fileData: {
                      fileUri: image.uri,
                      mimeType: image.mediaType,
                    } as FileData,
                  }
                : {
                    inlineData: {
                      mimeType: image.mediaType,
                      data: image.base64url,
                    } as Blob,
                  },
            ),
            ...(item.text ? [{ text: item.text }] : []),
            // Add file references for code execution if provided in config and this is the last user message
            ...(config.fileIds && config.fileIds.length > 0 && item === prompt[prompt.length - 1]
              ? config.fileIds.map((fileId) => {
                  // Find metadata if available to get mimeType
                  const fileMeta = config.uploadedFiles?.find((f) => f.fileId === fileId);
                  // Gemini uses fileUri for uploaded files via File API
                  // fileId here is expected to be the full resource name (files/xxxx) or uri
                  return {
                    fileData: {
                      fileUri: fileId.startsWith('files/')
                        ? `https://generativelanguage.googleapis.com/v1beta/${fileId}`
                        : fileId,
                      mimeType: fileMeta
                        ? mime.lookup(fileMeta.filename) || 'application/octet-stream'
                        : 'application/octet-stream',
                    } as FileData,
                  };
                })
              : []),
          ],
        };
        return content;
      } else {
        assert(item.type === 'assistant');
        const content: Content = {
          role: 'model' as const,
          parts: [
            ...(item.text ? [{ text: item.text }] : []),
            ...(item.images ?? []).map((image) =>
              image.uri
                ? {
                    fileData: {
                      mimeType: image.mediaType,
                      fileUri: image.uri,
                    } as FileData,
                  }
                : {
                    inlineData: {
                      mimeType: image.mediaType,
                      data: image.base64url,
                    } as Blob,
                  },
            ),
            ...(item.functionCalls ?? []).map((call) => ({
              functionCall: {
                name: call.name,
                args: call.args ?? {},
              },
              // https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures
              thoughtSignature: 'skip_thought_signature_validator',
            })),
            ...(item.executableCode
              ? [
                  {
                    executableCode: {
                      language: item.executableCode.language as Language,
                      code: item.executableCode.code,
                    },
                  },
                ]
              : []),
            ...(item.codeExecutionResult
              ? [
                  {
                    codeExecutionResult: {
                      outcome: item.codeExecutionResult.outcome as Outcome,
                      output: item.codeExecutionResult.output,
                    },
                  },
                ]
              : []),
          ],
        };
        return content;
      }
    });

  const req: GenerateContentParameters = {
    contents: messages,
    model: '',
    config: {},
  };

  if (functionDefs.length > 0) {
    req.config!.tools = [
      {
        functionDeclarations: JSON.parse(JSON.stringify(functionDefs)) as unknown as FunctionDeclaration[],
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
  if (expectedResponseType.webSearch) {
    req.config!.tools = [
      {
        googleSearch: {},
      },
    ];
    delete req.config!.toolConfig;
  }
  if (expectedResponseType.codeExecution) {
    req.config!.tools = [
      ...(req.config!.tools ?? []),
      {
        codeExecution: {},
      },
    ];
    // Code execution usually works best without forced function calling mode restrictions,
    // or at least it needs to be allowed.
    // If functionCall is false, we already set mode to NONE, which might block code execution tool use?
    // Actually, codeExecution is a tool. If mode is NONE, tools are disabled.
    // So if codeExecution is requested, we should probably ensure tool use is allowed.
    if (expectedResponseType.functionCall === false) {
      // If the user explicitly disabled function calls but enabled code execution,
      // we should probably allow tools but maybe restrict to code execution?
      // For now, let's assume if codeExecution is true, we don't force NONE.
      // But the logic above sets NONE if functionCall is false.
      // Let's override it if codeExecution is true.
      if (req.config!.toolConfig?.functionCallingConfig?.mode === FunctionCallingConfigMode.NONE) {
        delete req.config!.toolConfig;
      }
    }
  }

  const result = await internalGoogleModelsCall(
    serviceType,
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
    thinkingTokens: usageMetadata.thoughtsTokenCount,
    cacheReadTokens: usageMetadata.cachedContentTokenCount,
  };
  printTokenUsageAndCost({
    aiService: serviceType,
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
  if (functionCalls.length === 0 && expectedResponseType.text !== true && expectedResponseType.functionCall === true) {
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
          const recoveredCall = await recoverFunctionCall(serviceType, textResponse, [], functionDef);
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

  if (expectedResponseType.text) {
    for (const candidate of result.candidates) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.text && !part.thought) {
          resultParts.push({
            type: 'text',
            text: part.text,
          });
        }
      }
    }
  }

  if (expectedResponseType.webSearch) {
    for (const candidate of result.candidates) {
      const urls: Record<string, boolean> = {};
      for (const chunk of candidate.groundingMetadata?.groundingChunks ?? []) {
        if (chunk.web?.uri) {
          let url = chunk.web?.uri;
          try {
            const res = await axios.get(url);
            if (res.request.res.responseUrl) {
              url = res.request.res.responseUrl;
            } else if (res.status !== 200) {
              continue;
            }
          } catch (e) {
            if (axios.isAxiosError(e) && e.response?.request.res.responseUrl) {
              url = e.response.request.res.responseUrl;
            } else {
              continue;
            }
          }

          urls[url] = true;
        }
      }
      const text = candidate.content?.parts
        ?.filter((part) => part.text && !part.thought)
        .map((part) => part.text)
        .join('');
      if (text) {
        resultParts.push({
          type: 'webSearch',
          text: text,
          urls: Object.keys(urls),
        });
      }
    }
  }

  // Handle code execution parts
  for (const candidate of result.candidates) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.executableCode) {
        resultParts.push({
          type: 'executableCode',
          code: part.executableCode.code!,
          language: part.executableCode.language!,
        });
      }
      if (part.codeExecutionResult) {
        resultParts.push({
          type: 'codeExecutionResult',
          outcome: part.codeExecutionResult.outcome as 'OUTCOME_OK' | 'OUTCOME_FAILED' | 'OUTCOME_DEADLINE_EXCEEDED',
          output: part.codeExecutionResult.output!,
          // Note: Gemini API currently returns inline images or files as separate parts or within the output text/artifacts.
          // If the API evolves to return structured output files in codeExecutionResult, we should map them here.
          // For now, inline images might appear as separate parts with mimeType image/*.
        });
      }
    }
  }

  return resultParts;
}

function internalGoogleModelsCall(
  serviceType: 'ai-studio' | 'vertex-ai',
  modelType: ModelType,
  temperature: number,
  systemPrompt: string | undefined,
  geminiBlockNone: boolean | undefined,
  { contents, config }: Pick<GenerateContentParameters, 'contents' | 'config'>,
) {
  const serviceConfig = getServiceConfig(serviceType);
  assert(
    serviceType === 'vertex-ai' ? serviceConfig.googleCloudProjectId : serviceConfig.apiKey,
    serviceType === 'vertex-ai'
      ? 'Google Cloud Project ID not configured.'
      : 'API key not configured, use API_KEY environment variable',
  );
  const genAI =
    serviceType === 'vertex-ai'
      ? new GoogleGenAI({
          vertexai: true,
          project: serviceConfig.googleCloudProjectId,
          location: serviceConfig.googleCloudRegion ?? 'global',
        })
      : new GoogleGenAI({ apiKey: serviceConfig.apiKey });

  // Determine the model name based on model type
  const model = (() => {
    switch (modelType) {
      case ModelType.CHEAP:
        return serviceConfig.modelOverrides?.cheap ?? 'gemini-2.5-flash';
      case ModelType.LITE:
        return serviceConfig.modelOverrides?.lite ?? 'gemini-2.5-flash-lite';
      case ModelType.REASONING:
        return serviceConfig.modelOverrides?.reasoning ?? 'gemini-2.5-pro';
      default:
        return serviceConfig.modelOverrides?.default ?? 'gemini-2.5-pro';
    }
  })();

  console.log(`Using ${serviceType === 'vertex-ai' ? 'Vertex AI' : 'AI Studio'} model: ${model}`);

  // Get model-specific settings
  const {
    systemInstruction: modelSystemInstruction,
    outputTokenLimit,
    thinkingEnabled,
    thinkingBudget,
  } = getModelSettings(serviceType, model);
  // Combine base system prompt with model-specific instructions if available
  let effectiveSystemPrompt = systemPrompt || '';
  if (modelSystemInstruction?.length) {
    effectiveSystemPrompt += `\n${modelSystemInstruction.join('\n')}`;
  }

  const effectiveConfig = Object.assign(
    {
      maxOutputTokens: outputTokenLimit,
      temperature,
      topP: 0.95,
    },
    config,
  );

  if (typeof thinkingEnabled === 'boolean') {
    effectiveConfig.thinkingConfig = {
      thinkingBudget: thinkingEnabled ? -1 : 0,
    };

    if (thinkingBudget) {
      effectiveConfig.thinkingConfig.thinkingBudget = thinkingBudget;
    }
  }

  return genAI.models.generateContent({
    model,
    config: {
      abortSignal: abortController?.signal,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: geminiBlockNone ? HarmBlockThreshold.BLOCK_NONE : HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: geminiBlockNone ? HarmBlockThreshold.BLOCK_NONE : HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: geminiBlockNone ? HarmBlockThreshold.BLOCK_NONE : HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: geminiBlockNone ? HarmBlockThreshold.BLOCK_NONE : HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
      ],
      ...effectiveConfig,
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
  serviceType: 'ai-studio' | 'vertex-ai',
  textResponse: string,
  functionCalls: FunctionCall[],
  functionDef: FunctionDef,
): Promise<Record<string, unknown> | false> {
  console.log('Recovering function call');
  const schema: Schema = functionDef.parameters as unknown as Schema;
  const result = await internalGoogleModelsCall(
    serviceType,
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
