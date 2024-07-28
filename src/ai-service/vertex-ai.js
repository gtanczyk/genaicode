import assert from 'node:assert';
import { VertexAI } from '@google-cloud/vertexai';
import { printTokenUsageAndCost, processFunctionCalls } from './common.js';

/**
 * This function generates content using the Gemini Pro model.
 */

export async function generateContent(prompt, functionDefs) {
  const messages = prompt
    .filter((item) => item.type !== 'systemPrompt')
    .map((item) => {
      if (item.type === 'user') {
        return {
          role: 'user',
          parts: [
            ...(item.functionResponse
              ? [
                  {
                    functionResponse: {
                      name: item.functionResponse.name,
                      response: { name: item.functionResponse.name, content: item.functionResponse.content },
                    },
                  },
                ]
              : []),
            { text: item.text },
          ],
        };
      } else if (item.type === 'assistant') {
        return {
          role: 'model',
          parts: [
            ...(item.text ? [{ text: item.text }] : []),
            {
              functionCall: {
                name: item.functionCall.name,
                args: item.functionCall.args ?? {},
              },
            },
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
    // TODO: add tool_config once [it is supported](https://github.com/googleapis/nodejs-vertexai/issues/331)
  };

  const model = await getGenModel(prompt.find((item) => item.type === 'systemPrompt').systemPrompt);

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
export function getGenModel(systemPrompt) {
  // Initialize Vertex with your Cloud project and location
  const vertex_ai = new VertexAI({});
  const model = 'gemini-1.5-pro-001';

  // Instantiate the models
  return vertex_ai.preview.getGenerativeModel({
    model: model,
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0,
      topP: 0.95,
    },
    safetySettings: [
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_NONE',
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

const MONKEY_PATCH_FILE = '@google-cloud/vertexai/build/src/functions/generate_content.js';
const MONKEY_PATCH_TOOL_CONFIG = `// MONKEY PATCH TOOL_CONFIG`;

export async function verifyVertexMonkeyPatch() {
  return (await import(MONKEY_PATCH_FILE)).generateContent.toString().includes(MONKEY_PATCH_TOOL_CONFIG);
}
