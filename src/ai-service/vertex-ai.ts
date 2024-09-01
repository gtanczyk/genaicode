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
            ...item.functionCalls!.map((call) => ({
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
  printTokenUsageAndCost(usage, 0.000125 / 1000, 0.000375 / 1000);

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
    .map((call) => ({ name: call.name, args: call.args as Record<string, unknown> }));

  if (functionCalls.length === 0) {
    const textResponse = result.response.candidates
      .map((candidate) => candidate.content.parts?.map((part) => part.text))
      .flat()
      .filter((text): text is string => !!text)
      .join('\n');
    console.log('No function calls, output text response if it exists:', textResponse);
  }

  return processFunctionCalls(functionCalls);
}

// A function to get the generative model
// Modified to accept temperature parameter and cheap flag
export function getGenModel(
  systemPrompt: string,
  temperature: number,
  functionDefs: FunctionDef[],
  geminiBlockNone: boolean | undefined,
  requiredFunctionName: string | null,
  cheap = false,
) {
  // Initialize Vertex with your Cloud project and location
  const vertex_ai = new VertexAI({});
  const model = cheap ? 'gemini-1.5-flash-001' : 'gemini-1.5-pro-001';

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
    tools: [
      {
        functionDeclarations: functionDefs as unknown as FunctionDeclaration[],
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: cheap ? undefined : FunctionCallingMode.ANY,
        ...(!cheap && requiredFunctionName ? { allowedFunctionNames: [requiredFunctionName] } : {}),
      },
    },
  });
}
