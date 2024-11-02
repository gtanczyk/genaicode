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
import { printTokenUsageAndCost, processFunctionCalls, FunctionCall, PromptItem, FunctionDef } from './common.js';
import { CodegenOptions } from '../main/codegen-types.js';
import { abortController } from '../main/interactive/codegen-worker.js';
import { modelOverrides } from '../main/config.js';
import { unescapeFunctionCall } from './unescape-function-call.js';
import { disableVertexUnescape } from '../cli/cli-params.js';

/**
 * This function generates content using the Gemini Pro model.
 */
export async function generateContent(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  cheap = false,
  options: CodegenOptions,
): Promise<FunctionCall[]> {
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
            { text: item.text! },
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
    cheap,
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
    cheap,
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
    .map(disableVertexUnescape ? (call) => call : unescapeFunctionCall);

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
}

// A function to get the generative model
// Modified to accept temperature parameter and cheap flag
function getGenModel(
  systemPrompt: string,
  temperature: number,
  functionDefs: FunctionDef[] | undefined,
  geminiBlockNone: boolean | undefined,
  requiredFunctionName: string | null,
  cheap = false,
) {
  console.log('Recovering function call');
  // Initialize Vertex with your Cloud project and location
  const vertex_ai = new VertexAI({});
  const defaultModel = cheap ? 'gemini-1.5-flash-002' : 'gemini-1.5-pro-002';
  const model = cheap
    ? (modelOverrides.vertexAi?.cheap ?? defaultModel)
    : (modelOverrides.vertexAi?.default ?? defaultModel);

  console.log(`Using Vertex AI model: ${model}`);
  assert(process.env.GOOGLE_CLOUD_PROJECT, 'GOOGLE_CLOUD_PROJECT environment variable is not set');

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
    false,
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
    functionCalls.push(unescapeFunctionCall({ name: functionDef.name, args: parsed }));
    return true;
  } catch {
    return false;
  }
}
