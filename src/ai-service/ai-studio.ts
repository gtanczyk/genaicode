import {
  Content,
  FunctionCallingMode,
  FunctionDeclaration,
  GenerateContentRequest,
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
} from '@google/generative-ai';
import assert from 'node:assert';
import { FunctionCall, FunctionDef, printTokenUsageAndCost, processFunctionCalls, PromptItem } from './common.js';
import { CodegenOptions } from '../main/codegen-types.js';
import { abortController } from '../main/interactive/codegen-worker.js';
import { modelOverrides } from '../main/config.js';
import { unescapeFunctionCall } from './unescape-function-call.js';
import { disableVertexUnescape } from '../cli/cli-params.js';

/**
 * This function generates content using the Anthropic Claude model via Vertex AI.
 */
export async function generateContent(
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  requiredFunctionName: string | null,
  temperature: number,
  cheap = false,
  options: CodegenOptions,
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
          ],
        };
        return content;
      }
    });

  const req: GenerateContentRequest = {
    contents: messages,
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
  };

  const model = getModel(
    cheap ? 'gemini-1.5-flash-002' : 'gemini-1.5-pro-002',
    temperature,
    prompt.find((item) => item.type === 'systemPrompt')!.systemPrompt!,
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
  printTokenUsageAndCost({ usage, inputCostPerToken: 0.000125 / 1000, outputCostPerToken: 0.000375 / 1000, cheap });

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
    const textResponse = result.response.candidates
      .map((candidate) => candidate.content.parts?.map((part) => part.text))
      .flat()
      .filter((text): text is string => !!text)
      .join('\n');
    console.log('No function calls, output text response if it exists:', textResponse);
  }

  return processFunctionCalls(functionCalls);
}

function getModel(
  defaultModel: string,
  temperature: number,
  systemPrompt: string,
  geminiBlockNone: boolean | undefined,
) {
  assert(process.env.API_KEY, 'API_KEY environment variable is not set');
  const genAI = new GoogleGenerativeAI(process.env.API_KEY);

  const cheap = defaultModel === 'gemini-1.5-flash-001';
  const model = cheap
    ? (modelOverrides.aiStudio?.cheap ?? defaultModel)
    : (modelOverrides.aiStudio?.default ?? defaultModel);

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
    systemInstruction: {
      role: 'system',
      parts: [
        {
          text: systemPrompt,
        },
      ],
    },
  });
}
