import assert from 'node:assert';
import { VertexAI } from '@google-cloud/vertexai';
import { functionDefs } from './function-calling.js';
import { getSourceCode } from '../files/read-files.js';

// A function to generate content using the generative model
export async function generateContent(systemPrompt, prompt) {
  const req = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: prompt,
          },
        ],
      },
      {
        role: 'model',
        parts: [
          {
            text: 'Please provide application source code.',
          },
          {
            functionCall: {
              name: 'getSourceCode',
              args: {},
            },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'getSourceCode',
              response: { name: 'getSourceCode', content: JSON.stringify(getSourceCode()) },
            },
          },
        ],
      },
    ],
    tools: [
      {
        functionDeclarations: functionDefs,
      },
    ],
    // TODO: add tool_config once [it is supported](https://github.com/googleapis/nodejs-vertexai/issues/331)
  };

  const model = await getGenModel(systemPrompt);

  assert(
    (await import('@google-cloud/vertexai/build/src/functions/generate_content.js')).generateContent
      .toString()
      .includes(MONKEY_PATCH_TOOL_CONFIG),
    'Vertex AI Tool Config was not monkey patched',
  );

  const result = await model.generateContent(req);

  // Print token usage
  const usageMetadata = result.response.usageMetadata;
  console.log('Token Usage:');
  console.log('  - Candidates tokens: ', usageMetadata.candidatesTokenCount);
  console.log('  - Prompt tokens: ', usageMetadata.promptTokenCount);
  console.log('  - Total tokens: ', usageMetadata.totalTokenCount);

  // Calculate and print the estimated cost
  const inputCost = (usageMetadata.promptTokenCount * 0.000125) / 1000;
  const outputCost = (usageMetadata.candidatesTokenCount * 0.000375) / 1000;
  const totalCost = inputCost + outputCost;
  console.log('  - Estimated cost: ', totalCost.toFixed(6), ' USD');

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

  assert(
    functionCalls.every((call) => functionDefs.some((fd) => fd.name === call.name)),
    'Unknown function name',
  );

  if (functionCalls.length === 0) {
    const textResponse = result.response.candidates
      .map((candidate) => candidate.content.parts?.map((part) => part.text))
      .flat()
      .filter((text) => !!text)
      .join('\n');
    console.log('No function calls, output text response if it exists:', textResponse);
  }

  console.log(
    'Explanations:',
    functionCalls.filter((fn) => fn.name === 'explanation').map((call) => call.args.text),
  );

  return functionCalls.filter((fn) => fn.name !== 'explanation');
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

const MONKEY_PATCH_TOOL_CONFIG = `// MONKEY PATCH TOOL_CONFIG`;
// MONKEY PATCH TOOL_CONFIG
// data: {
//     ...generateContentRequest,
//     tool_config: {
//         function_calling_config: { mode: "ANY" }
//     }
// },`;
