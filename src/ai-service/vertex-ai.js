import assert from 'node:assert';
import { VertexAI } from '@google-cloud/vertexai';
import { printTokenUsageAndCost, processFunctionCalls } from './common.js';
import { geminiBlockNone } from '../cli/cli-params.js';

/**
 * This function generates content using the Gemini Pro model.
 */

export async function generateContent(prompt, functionDefs, requiredFunctionName, temperature, cheap = false) {
  const messages = prompt
    .filter((item) => item.type !== 'systemPrompt')
    .map((item) => {
      if (item.type === 'user') {
        return {
          role: 'user',
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
            { text: item.text },
          ],
        };
      } else if (item.type === 'assistant') {
        return {
          role: 'model',
          parts: [
            ...(item.text ? [{ text: item.text }] : []),
            ...item.functionCalls.map((call) => ({
              functionCall: {
                name: call.name,
                args: call.args ?? {},
              },
            })),
          ],
        };
      }
    });

  const req = {
    contents: messages,
    tools: [
      {
        functionDeclarations: functionDefs,
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: cheap ? undefined : 'ANY',
        ...(!cheap && requiredFunctionName ? { allowedFunctionNames: [requiredFunctionName] } : {}),
      },
    },
  };

  const model = await getGenModel(prompt.find((item) => item.type === 'systemPrompt').systemPrompt, temperature, cheap);

  assert(await verifyVertexMonkeyPatch(), 'Vertex AI Tool Config was not monkey patched');

  const result = await model.generateContent(req);

  // Print token usage
  const usageMetadata = result.response.usageMetadata;
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

  if (!result.response.candidates?.length > 0) {
    console.log('Response:', result);
    throw new Error('No candidates found');
  }

  const functionCalls = result.response.candidates
    .map((candidate) => candidate.content.parts?.map((part) => part.functionCall))
    .flat()
    .filter((functionCall) => !!functionCall);

  if (functionCalls.length === 0) {
    const textResponse = result.response.candidates
      .map((candidate) => candidate.content.parts?.map((part) => part.text))
      .flat()
      .filter((text) => !!text)
      .join('\n');
    console.log('No function calls, output text response if it exists:', textResponse);
  }

  return processFunctionCalls(functionCalls);
}

// A function to get the generative model
// Modified to accept temperature parameter and cheap flag
export function getGenModel(systemPrompt, temperature, cheap = false) {
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
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: geminiBlockNone ? 'BLOCK_NONE' : 'BLOCK_LOW_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: geminiBlockNone ? 'BLOCK_NONE' : 'BLOCK_LOW_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: geminiBlockNone ? 'BLOCK_NONE' : 'BLOCK_LOW_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: geminiBlockNone ? 'BLOCK_NONE' : 'BLOCK_LOW_AND_ABOVE',
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

export async function verifyVertexMonkeyPatch() {
  return (await import('@google-cloud/vertexai/build/src/functions/generate_content.js')).generateContent
    .toString()
    .includes('// MONKEY PATCH TOOL_CONFIG');
}
