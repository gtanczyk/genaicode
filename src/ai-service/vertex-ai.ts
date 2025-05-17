import assert from 'node:assert';
import {
  VertexAI,
  GenerateContentRequest,
  Content,
  Part,
  HarmCategory,
  HarmBlockThreshold,
  FunctionDeclaration,
  FunctionCallingMode,
  GenerationConfig,
  Tool,
  ToolConfig,
  SafetySetting,
  GenerateContentResult as VertexGenerateContentResult,
  SchemaType,
  Schema,
} from '@google-cloud/vertexai';
import { printTokenUsageAndCost } from './common.js';
import {
  GenerateContentFunction,
  GenerateContentResult,
  GenerateContentResultPart,
  PromptItem,
  FunctionCall,
  FunctionDef,
  ModelType,
} from './common-types.js';
import { abortController } from '../main/common/abort-controller.js';
import { unescapeFunctionCall } from './unescape-function-call.js';
import { enableVertexUnescape } from '../cli/cli-params.js';
import { getServiceConfig, getModelSettings } from './service-configurations.js';

/**
 * This function generates content using the Vertex AI Gemini models with the new interface.
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
  try {
    // Limitation: https://github.com/googleapis/nodejs-vertexai/issues/143
    abortController?.signal.throwIfAborted();

    const modelType = config.modelType ?? ModelType.DEFAULT;
    const temperature = config.temperature ?? 0.7;
    const functionDefs = config.functionDefs ?? [];
    const requiredFunctionName = config.requiredFunctionName ?? null;
    const expectedResponseType = config.expectedResponseType ?? { text: false, functionCall: true, media: false };

    const messages: Content[] = prompt
      .filter((item) => item.type === 'user' || item.type === 'assistant')
      .map((item) => {
        const parts: Part[] = [];
        if (item.type === 'user') {
          if (item.functionResponses) {
            parts.push(
              ...item.functionResponses.map((response) => ({
                functionResponse: {
                  name: response.name,
                  response: { name: response.name, content: response.content },
                },
              })),
            );
          }
          if (item.images) {
            parts.push(
              ...item.images.map((image) =>
                image.uri
                  ? {
                      fileData: {
                        fileUri: image.uri,
                        mimeType: image.mediaType,
                      },
                    }
                  : {
                      inlineData: {
                        mimeType: image.mediaType,
                        data: image.base64url,
                      },
                    },
              ),
            );
          }
          if (item.text) {
            parts.push({ text: item.text });
          }
          return { role: 'user' as const, parts };
        } else {
          assert(item.type === 'assistant');
          if (item.text) {
            parts.push({ text: item.text });
          }
          if (item.functionCalls) {
            parts.push(
              ...item.functionCalls.map((call) => ({
                functionCall: {
                  name: call.name,
                  args: call.args ?? {},
                },
              })),
            );
          }
          // Note: Vertex AI SDK currently might not fully support model generating images in parts
          if (item.images) {
            parts.push(
              ...item.images.map((image) => ({
                inlineData: {
                  mimeType: image.mediaType,
                  data: image.base64url,
                },
              })),
            );
          }
          return { role: 'model' as const, parts };
        }
      });

    const req: GenerateContentRequest = {
      contents: messages,
    };

    const modelInstance = await getGenModel({
      systemPromptText: prompt.find((item) => item.type === 'systemPrompt')?.systemPrompt,
      temperature,
      functionDefs,
      geminiBlockNone: options.geminiBlockNone,
      requiredFunctionName,
      modelType,
      expectedResponseType,
    });

    const result = await modelInstance.generateContent(req);

    // Print token usage
    const usageMetadata = result.response.usageMetadata;
    if (usageMetadata) {
      const usage = {
        inputTokens: usageMetadata.promptTokenCount,
        outputTokens: usageMetadata.candidatesTokenCount,
        totalTokens: usageMetadata.totalTokenCount,
      };
      printTokenUsageAndCost({
        aiService: 'vertex-ai',
        usage,
        inputCostPerToken: 0.000125 / 1000, // Example cost, adjust as needed
        outputCostPerToken: 0.000375 / 1000, // Example cost, adjust as needed
        modelType,
      });
    } else {
      console.log('Usage metadata not available.');
    }

    if (result.response.promptFeedback) {
      console.log('Prompt feedback:');
      console.log(JSON.stringify(result.response.promptFeedback, null, 2));
    }

    if (!result.response.candidates?.length) {
      console.log('Response:', result);
      throw new Error('No candidates found');
    }

    const functionCalls = result.response.candidates
      .flatMap((candidate) => candidate.content.parts?.filter((part) => part.functionCall))
      .map((part) => part.functionCall)
      .filter((functionCall): functionCall is NonNullable<typeof functionCall> => !!functionCall)
      .map((call) => ({ name: call.name, args: call.args as Record<string, unknown> }))
      .map(enableVertexUnescape ? unescapeFunctionCall : (call) => call); // Apply unescaping based on flag

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

    // Handle text response if no function calls were returned or if text is expected
    if (functionCalls.length === 0 || expectedResponseType.text) {
      const textResponse =
        result.response.candidates
          ?.flatMap((candidate) => candidate.content.parts?.filter((part) => part.text))
          .map((part) => part.text)
          .filter((text): text is string => !!text)
          .join('\n') ?? // Join multiple text parts if they exist
        result.response.candidates?.map((candidate) =>
          // @ts-expect-error: finishReason might not be typed correctly in SDK
          candidate.finishReason === 'MALFORMED_FUNCTION_CALL' ? candidate.finishMessage : '',
        )[0] ??
        ''; // Default to empty string

      if (textResponse) {
        if (expectedResponseType.text) {
          resultParts.push({
            type: 'text',
            text: textResponse,
          });
        }

        // Try to recover function call from text if required function name is provided and no calls were found initially
        const functionDef = functionDefs.find((def) => def.name === requiredFunctionName);
        if (expectedResponseType.functionCall && functionDef && functionCalls.length === 0) {
          try {
            const recoveredCall = await recoverFunctionCall(textResponse, functionDef);
            if (recoveredCall) {
              console.log('Recovered function call.');
              resultParts.push({
                type: 'functionCall',
                functionCall: recoveredCall,
              });
            }
          } catch (error) {
            console.log('Failed to recover function call:', error);
          }
        }
      }
    }

    // Note: Vertex AI SDK might not return media parts directly in the same way as AI Studio.
    // If media generation is needed, a separate API call (e.g., Imagen) might be required.

    return resultParts;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Project ID not configured')) {
      throw new Error('Google Cloud Project ID not configured. Please set up the service configuration.');
    }
    throw error;
  }
};

interface GetGenModelParams {
  systemPromptText: string | undefined;
  temperature: number;
  functionDefs: FunctionDef[];
  geminiBlockNone: boolean | undefined;
  requiredFunctionName: string | null;
  modelType: ModelType;
  expectedResponseType: {
    text: boolean;
    functionCall: boolean;
    media: boolean;
  };
}

// A function to get the generative model instance
async function getGenModel(params: GetGenModelParams) {
  const {
    systemPromptText,
    temperature,
    functionDefs,
    geminiBlockNone,
    requiredFunctionName,
    modelType,
    expectedResponseType,
  } = params;

  try {
    const serviceConfig = getServiceConfig('vertex-ai');
    assert(serviceConfig?.googleCloudProjectId, 'Google Cloud Project ID not configured.');

    // Initialize Vertex with your Cloud project and location
    const vertex_ai = new VertexAI({ project: serviceConfig.googleCloudProjectId });

    // Determine model name
    const defaultModelName = modelType === ModelType.CHEAP ? 'gemini-2.0-flash' : 'gemini-1.5-pro-002';
    const modelOverrides = serviceConfig?.modelOverrides;
    const modelName =
      (modelType === ModelType.CHEAP
        ? modelOverrides?.cheap
        : modelType === ModelType.REASONING
          ? modelOverrides?.reasoning // Use reasoning override if specified
          : modelOverrides?.default) ?? defaultModelName;

    console.log(`Using Vertex AI model: ${modelName}`);

    // Get model-specific settings
    const { systemInstruction: modelSystemInstruction, outputTokenLimit } = getModelSettings('vertex-ai', modelName);

    // Combine base system prompt with model-specific instructions
    let effectiveSystemPrompt = systemPromptText ?? '';
    if (modelSystemInstruction?.length) {
      effectiveSystemPrompt += `\n${modelSystemInstruction.join('\n')}`;
    }

    // Configure generation
    const generationConfig: GenerationConfig = {
      maxOutputTokens: outputTokenLimit, // Use the potentially model-specific limit
      temperature: temperature,
      topP: 0.95,
    };

    // Configure safety settings
    const safetySettings: SafetySetting[] = [
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
    ];

    // Configure tools and tool config
    let tools: Tool[] | undefined = undefined;
    let toolConfig: ToolConfig | undefined = undefined;

    if (functionDefs.length > 0 && expectedResponseType.functionCall) {
      tools = [
        {
          functionDeclarations: functionDefs as unknown as FunctionDeclaration[],
        },
      ];
      toolConfig = {
        functionCallingConfig: {
          mode: FunctionCallingMode.ANY,
          ...(requiredFunctionName ? { allowedFunctionNames: [requiredFunctionName] } : {}),
        },
      };
    } else if (!expectedResponseType.functionCall) {
      toolConfig = {
        functionCallingConfig: {
          mode: FunctionCallingMode.NONE,
        },
      };
    }

    // Instantiate the model
    return vertex_ai.preview.getGenerativeModel({
      model: modelName,
      generationConfig,
      safetySettings,
      ...(effectiveSystemPrompt
        ? {
            systemInstruction: {
              role: 'system', // Role should be 'system'
              parts: [{ text: effectiveSystemPrompt }],
            },
          }
        : {}),
      ...(tools ? { tools } : {}),
      ...(toolConfig ? { toolConfig } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Project ID not configured')) {
      throw new Error('Google Cloud Project ID not configured. Please set up the service configuration.');
    }
    throw error;
  }
}

// Function to attempt recovery of a function call from text response using JSON mode
async function recoverFunctionCall(textResponse: string, functionDef: FunctionDef): Promise<FunctionCall | null> {
  console.log('Attempting to recover function call:', functionDef.name);
  try {
    // @ts-expect-error: functionDef.parameters might not be typed correctly in SDK
    const schema: Schema = { ...functionDef.parameters, type: SchemaType.OBJECT };

    // Use a cheap model for recovery
    const recoveryModel = await getGenModel({
      systemPromptText:
        'Your role is read the text below and extract the parameters for the function call based on the provided schema. Output ONLY the JSON object representing the arguments.',
      temperature: 0.1, // Low temperature for deterministic extraction
      functionDefs: [], // No function calling needed for recovery itself
      geminiBlockNone: undefined,
      requiredFunctionName: null,
      modelType: ModelType.CHEAP, // Always use cheap model for recovery
      expectedResponseType: { text: true, functionCall: false, media: false }, // Expect only text
    });

    // Get specific settings for the recovery model
    const recoveryModelName = getServiceConfig('vertex-ai').modelOverrides?.cheap ?? 'gemini-2.0-flash';
    const { outputTokenLimit: recoveryOutputLimit } = getModelSettings('vertex-ai', recoveryModelName);

    const recoveryReq: GenerateContentRequest = {
      contents: [
        {
          role: 'user' as const,
          parts: [
            { text: `Function Name: ${functionDef.name}` },
            { text: `Function Description: ${functionDef.description}` },
            { text: `Input Text:\n${textResponse}` },
          ],
        },
      ],
      // generationConfig modification for JSON output
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.1,
        maxOutputTokens: recoveryOutputLimit, // Use limit for the recovery model
      },
    };

    const result: VertexGenerateContentResult = await recoveryModel.generateContent(recoveryReq);

    const recoveredText = result.response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!recoveredText) {
      console.log('Recovery failed: No text content in response.');
      return null;
    }

    try {
      const parsedArgs = JSON.parse(recoveredText);
      const recoveredCall: FunctionCall = { name: functionDef.name, args: parsedArgs };

      console.log('Recovery successful.');
      // Apply unescaping if needed
      return enableVertexUnescape ? unescapeFunctionCall(recoveredCall) : recoveredCall;
    } catch (parseError) {
      console.log('Recovery failed: Could not parse JSON response.', parseError, 'Response text:', recoveredText);
      return null;
    }
  } catch (error) {
    console.error('Error during function call recovery:', error);
    return null;
  }
}
