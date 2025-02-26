import { describe, it, expect, vi } from 'vitest';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateContent as generateContentOpenAI } from '../ai-service/openai.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentVertexAiClaude } from '../ai-service/vertex-ai-claude.js';
import { PromptItem } from '../ai-service/common-types.js';
import { FunctionCall } from '../ai-service/common-types.js';
import { ModelType } from '../ai-service/common-types.js';
import { getSystemPrompt } from '../prompt/systemprompt.js';
import {
  ReasoningInferenceArgs,
  ReasoningInferenceResponseArgs,
} from '../prompt/steps/step-ask-question/step-ask-question-types.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import {
  INITIAL_GREETING,
  READY_TO_ASSIST,
  REQUEST_SOURCE_CODE,
  SOURCE_CODE_RESPONSE,
} from '../prompt/static-prompts.js';
import {
  MOCK_SOURCE_CODE_SUMMARIES_LARGE,
  MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
} from './data/mock-source-code-summaries-large.js';
import { getRegisteredAiServices } from '../main/plugin-loader.js';
import { PluginAiServiceType } from '../ai-service/service-configurations-types.js';

vi.setConfig({
  testTimeout: 3 * 60000,
});

describe.each([
  { model: 'Gemini Flash Thinking', generateContent: generateContentAiStudio },
  { model: 'O1', generateContent: generateContentOpenAI },
  { model: 'DeepSeek R1', generateContent: getPluginGenerateContentFn('plugin:deepseek-ai-service') },
  { model: 'Claude', generateContent: generateContentAnthropic },
  { model: 'Claude Vertex (emulated)', generateContent: generateContentVertexAiClaude },
])('Reasoning inerence: $model', ({ model, generateContent }) => {
  it('should generate prompt', async () => {
    const prompt: PromptItem[] = [
      {
        type: 'systemPrompt',
        systemPrompt: getSystemPrompt(
          { rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR },
          {
            askQuestion: true,
            ui: true,
            allowFileCreate: true,
            allowFileDelete: true,
            allowDirectoryCreate: true,
            allowFileMove: true,
          },
        ),
      },
      { type: 'user', text: INITIAL_GREETING },
      {
        type: 'assistant',
        text: REQUEST_SOURCE_CODE,
        functionCalls: [{ name: 'getSourceCode' }],
      },
      {
        type: 'user',
        text: SOURCE_CODE_RESPONSE,
        functionResponses: [
          {
            name: 'getSourceCode',
            content: JSON.stringify(MOCK_SOURCE_CODE_SUMMARIES_LARGE),
          },
        ],
      },
      {
        type: 'assistant',
        text: READY_TO_ASSIST,
      },
      {
        type: 'user',
        text: 'how can we make auth more secure?',
      },
      {
        type: 'assistant',
        text: 'I can help you with that. Let me think about it.',
      },
      {
        type: 'user',
        text: 'Please generate a prompt and context for the reasoning inference model. Make sure to be detailed and exhaustive, include full content of relevant information in the context items.',
      },
    ];

    // Execute ask question step with reasoning model type
    const temperature = 0.2;
    const [inference] = (await generateContent(
      prompt,
      getFunctionDefs(),
      'reasoningInference',
      temperature,
      ModelType.CHEAP,
    )) as [FunctionCall<ReasoningInferenceArgs>];

    console.log(JSON.stringify(inference, null, 2));

    expect(inference).toBeDefined();
  });

  it('should provide detailed reasoning for a task', async () => {
    // Prepare prompt items for testing
    const prompt: PromptItem[] = [
      {
        type: model === 'O1' ? /* temporary workaround */ 'user' : 'systemPrompt',
        systemPrompt: getSystemPrompt(
          { rootDir: '/project' },
          {
            askQuestion: false,
            allowFileCreate: true,
            allowFileDelete: true,
            allowDirectoryCreate: true,
            allowFileMove: true,
          },
        ),
      },
      {
        type: 'user',
        text: 'how to improve genicode system prompt?',
      },
    ];

    // Execute ask question step with reasoning model type
    const temperature = 0.2;
    const [response] = (await generateContent(prompt, [], null, temperature, ModelType.REASONING)) as [
      FunctionCall<ReasoningInferenceResponseArgs>,
    ];

    // Log the askQuestion call for debugging
    console.log(JSON.stringify(response, null, 2));

    // Verify the response
    expect(response).toBeDefined();
  });
});

function getPluginGenerateContentFn(pluginKey: PluginAiServiceType) {
  return getRegisteredAiServices().get(pluginKey)!.generateContent!;
}
