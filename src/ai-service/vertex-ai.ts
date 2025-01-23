import assert from 'node:assert';
import {
  VertexAI,
  GenerateContentRequest,
  Content,
  HarmCategory,
  HarmBlockThreshold,
  FunctionDeclaration,
  FunctionCallingMode,
} from '@google-cloud/vertexai';
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
 * This function generates content using the Gemini Pro model.
 */
export const generateContent: GenerateContentFunction = async function generateContent(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  modelType = ModelType.DEFAULT,
  options: { geminiBlockNone?: boolean } = {},
): Promise<FunctionCall[]> {
  try {
    // Limitation: https://github.com/googleapis/nodejs-vertexai/issues/143
    abortController?.signal.throwIfAborted();

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
              ...(item.functionCalls ?? []).map((call) => ({
                functionCall: {
                  name: call.name,
                  args: call.args ?? {},
                },
              })),
              ...(item.images ?? []).map((image) => ({
                inlineData: {
                  mimeType: image.mediaType,
                  data: image.base64url,
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

    const model = await getGenModel(
      prompt.find((item) => item.type === 'systemPrompt')!.systemPrompt!,
      temperature,
      functionDefs,
      options.geminiBlockNone,
      requiredFunctionName,
      modelType,
    );

    const result = await model.generateContent(req);

    // Print token usage
    const usageMetadata = result.response.usageMetadata!;
    const usage = {
      inputTokens: usageMetadata.promptTokenCount,
      outputTokens: usageMetadata.candidatesTokenCount,
      totalTokens: usageMetadata.totalTokenCount,
    };
    printTokenUsageAndCost({
      aiService: 'vertex-ai',
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
      .map((candidate) => candidate.content.parts?.map((part) => part.functionCall))
      .flat()
      .filter((functionCall): functionCall is NonNullable<typeof functionCall> => !!functionCall)
      .map((call) => ({ name: call.name, args: call.args as Record<string, unknown> }))
      .map(enableVertexUnescape ? (call) => call : unescapeFunctionCall);

    if (functionCalls.length === 0) {
      const textResponse =
        result.response.candidates
          .map((candidate) => candidate.content.parts?.map((part) => part.text))
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
  } catch (error) {
    if (error instanceof Error && error.message.includes('Project ID not configured')) {
      throw new Error('Google Cloud Project ID not configured. Please set up the service configuration.');
    }
    throw error;
  }
};

// A function to get the generative model
// Modified to accept temperature parameter and cheap flag
function getGenModel(
  systemPrompt: string,
  temperature: number,
  functionDefs: FunctionDef[] | undefined,
  geminiBlockNone: boolean | undefined,
  requiredFunctionName: string | null,
  modelType: ModelType = ModelType.DEFAULT,
) {
  try {
    console.log('Recovering function call');
    const serviceConfig = getServiceConfig('vertex-ai');
    // Initialize Vertex with your Cloud project and location
    const vertex_ai = new VertexAI({ project: serviceConfig?.googleCloudProjectId });

    const defaultModel = modelType === ModelType.CHEAP ? 'gemini-1.5-flash-002' : 'gemini-1.5-pro-002';
    const modelOverrides = serviceConfig?.modelOverrides;
    const model =
      modelType === ModelType.CHEAP
        ? (modelOverrides?.cheap ?? defaultModel)
        : (modelOverrides?.default ?? defaultModel);

    console.log(`Using Vertex AI model: ${model}`);

    // Instantiate the models
    return vertex_ai.preview.getGenerativeModel({
      model: model,
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: temperature,
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
      systemInstruction: {
        role: 'system',
        parts: [
          {
            text: systemPrompt,
          },
        ],
      },
      ...((functionDefs?.length ?? 0) > 0
        ? {
            tools: [
              {
                functionDeclarations: functionDefs as unknown as FunctionDeclaration[],
              },
            ],
            toolConfig: {
              functionCallingConfig: {
                mode: FunctionCallingMode.ANY,
                ...(requiredFunctionName ? { allowedFunctionNames: [requiredFunctionName] } : {}),
              },
            },
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Project ID not configured')) {
      throw new Error('Google Cloud Project ID not configured. Please set up the service configuration.');
    }
    throw error;
  }
}

async function recoverFunctionCall(
  textResponse: string,
  functionCalls: FunctionCall[],
  functionDef: FunctionDef,
): Promise<boolean> {
  // @ts-expect-error: "object" !== "OBJECT"
  const schema: ResponseSchema = functionDef.parameters;
  const result = await getGenModel(
    'Your role is read the text below and if possible, return it in the desired format.',
    0.2,
    undefined,
    undefined,
    null,
    ModelType.DEFAULT,
  ).generateContent({
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
  });

  try {
    const text = result.response.candidates?.[0].content.parts[0].text;
    if (!text) {
      return false;
    }
    const parsed = JSON.parse(text);
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
