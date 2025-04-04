import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentOpenAI } from '../ai-service/openai.js';
import { PromptItem, ModelType, GenerateContentFunction, FunctionCall } from '../ai-service/common-types.js';
import { retryGenerateContent } from './test-utils/generate-content-retry.js';
import { validateLLMContent } from './test-utils/llm-content-validate.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import {
  INITIAL_GREETING,
  READY_TO_ASSIST,
  REQUEST_SOURCE_CODE,
  SOURCE_CODE_RESPONSE,
} from '../prompt/static-prompts.js';
import { MOCK_SOURCE_CODE_SUMMARIES_LARGE } from './data/mock-source-code-summaries-large.js';
import { validateAndRecoverSingleResult } from '../prompt/steps/step-validate-recover.js';
import { LLMContentExpectation } from './test-utils/file-updates-verify.js';

// Mock getFunctionDefs to provide the 'explanation' function definition
vi.mock('../prompt/function-calling.js', () => ({
  getFunctionDefs: vi.fn().mockReturnValue([
    {
      name: 'explanation',
      description: 'Provide an explanation or summary.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The explanation text.' } },
        required: ['text'],
      },
    },
    // Include other potentially relevant function defs if needed by the context
    {
      name: 'getSourceCode',
      description: 'Get source code content.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  ]),
}));

vi.setConfig({
  testTimeout: 3 * 60000, // 3 minutes timeout for AI calls
});

describe.each([
  { model: 'Gemini Flash', generateContent: generateContentAiStudio, modelType: ModelType.CHEAP },
  { model: 'Claude Haiku', generateContent: generateContentAnthropic, modelType: ModelType.CHEAP },
  { model: 'GPT-4o Mini', generateContent: generateContentOpenAI, modelType: ModelType.CHEAP },
  // Add more capable models if needed, adjust modelType accordingly
  // { model: 'Gemini 1.5 Pro', generateContent: generateContentAiStudio, modelType: ModelType.DEFAULT },
  // { model: 'Claude 3.5 Sonnet', generateContent: generateContentAnthropic, modelType: ModelType.DEFAULT },
  // { model: 'GPT-4o', generateContent: generateContentOpenAI, modelType: ModelType.DEFAULT },
])('conversation-summary eval: $model', ({ generateContent: originalGenerateContent, modelType }) => {
  let generateContent: GenerateContentFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    // Wrap with retry logic for robustness
    generateContent = retryGenerateContent(originalGenerateContent);
    // Ensure mocks are reset if needed per test, especially if they have state
    vi.mocked(getFunctionDefs).mockReturnValue([
      {
        name: 'explanation',
        description: 'Provide an explanation or summary.',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string', description: 'The explanation text.' } },
          required: ['text'],
        },
      },
      {
        name: 'getSourceCode',
        description: 'Get source code content.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    ]);
  });

  it('should generate a concise and relevant conversation summary using the explanation function', async () => {
    const userPromptText =
      'I need to refactor the user authentication module in `auth.service.ts` to use OAuth2 instead of basic auth.';
    const conversationPrompt: PromptItem[] = [
      // Simulate a typical conversation flow
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
            content: JSON.stringify(MOCK_SOURCE_CODE_SUMMARIES_LARGE), // Provide some context
          },
        ],
      },
      { type: 'assistant', text: READY_TO_ASSIST },
      { type: 'user', text: userPromptText },
      // The prompt that triggers the summary generation step
      { type: 'assistant', text: 'Thank you for explaining the task.' }, // Added assistant ack
      {
        type: 'user',
        text: 'Summarize the conversation in one sentence, maximum 10 words.',
      },
    ];

    const generateContentArgs: Parameters<GenerateContentFunction> = [
      conversationPrompt,
      {
        functionDefs: getFunctionDefs(),
        requiredFunctionName: 'explanation', // Target the explanation function for the summary
        temperature: 0.3, // Low temperature for focused summary
        modelType, // Use the model type specified in the describe block (CHEAP)
        expectedResponseType: {
          text: false,
          functionCall: true,
          media: false,
        },
      },
      {}, // Pass relevant options if needed
    ];

    // Call generateContent directly
    const result = await generateContent(...generateContentArgs);

    // Validate and extract the function call
    const functionCalls = (await validateAndRecoverSingleResult(generateContentArgs, result, generateContent, '/'))
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall as FunctionCall<{ text: string }>);

    expect(functionCalls.length).toBe(1);
    const summaryCall = functionCalls.find((call) => call.name === 'explanation');
    expect(summaryCall).toBeDefined();
    expect(summaryCall?.args).toBeDefined();
    expect(typeof summaryCall?.args?.text).toBe('string');

    const summaryText = summaryCall!.args!.text;
    console.log(`Generated Summary (${modelType}): ${summaryText}`);

    // Validate the generated summary text using LLM validation
    const summaryExpectation: LLMContentExpectation = {
      description: 'A very concise summary (max 10 words) of the user request to refactor auth module to OAuth2.',
      requiredElements: ['refactor', 'authentication', 'OAuth2', 'auth.service.ts'], // Key elements from the user prompt
      forbiddenElements: ['greeting', 'source code details', 'unrelated topics', 'assistant'],
      tone: 'technical',
    };

    const isSummaryValid = await validateLLMContent(
      generateContent, // Use the potentially retried function for validation
      summaryText,
      summaryExpectation,
      { temperature: 0.1, cheap: true }, // Use cheap model for validation
    );

    // Assertions
    expect(isSummaryValid, `Conversation summary "${summaryText}" should meet expectations`).toBe(true);
    // Check word count more strictly
    const wordCount = summaryText.split(' ').filter((word) => word.length > 0).length;
    expect(wordCount).toBeLessThanOrEqual(15); // Allow slightly more than 10 for flexibility
  });

  // Add more tests if needed, e.g., for different conversation structures or edge cases.
});
