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
// Import the function to prepare the summary prompt
import { prepareSummaryPrompt } from '../prompt/steps/step-generate-summary.js';

vi.setConfig({
  testTimeout: 5 * 60000, // 5 minutes timeout for potentially longer AI calls
});

// Helper to create common conversation prefix
const createConversationPrefix = (): PromptItem[] => [
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
];

// Helper to run the test logic for a given scenario
async function runSummaryTest(
  generateContent: GenerateContentFunction,
  modelType: ModelType,
  conversationHistory: PromptItem[], // Renamed from conversationPrompt
  summaryExpectation: LLMContentExpectation,
  maxWords = 10, // Default maxWords to 10 as per prepareSummaryPrompt
) {
  // Prepare the prompt using the imported function
  const finalPrompt = prepareSummaryPrompt(conversationHistory);

  const generateContentArgs: Parameters<GenerateContentFunction> = [
    finalPrompt, // Use the prepared prompt
    {
      functionDefs: getFunctionDefs(),
      requiredFunctionName: 'conversationSummary',
      temperature: 0.3,
      modelType,
      expectedResponseType: {
        text: false,
        functionCall: true,
        media: false,
      },
    },
    {},
  ];

  const result = await generateContent(...generateContentArgs);

  const functionCalls = (await validateAndRecoverSingleResult(generateContentArgs, result, generateContent, '/'))
    .filter((item) => item.type === 'functionCall')
    .map((item) => item.functionCall as FunctionCall<{ title: string }>);

  expect(functionCalls.length).toBe(1);
  const summaryCall = functionCalls.find((call) => call.name === 'conversationSummary');
  expect(summaryCall).toBeDefined();
  expect(summaryCall?.args).toBeDefined();
  expect(typeof summaryCall?.args?.title).toBe('string');

  const summaryText = summaryCall!.args!.title;
  console.log(`Generated Summary (${modelType}): ${summaryText}`);

  const isSummaryValid = await validateLLMContent(
    generateContent,
    summaryText,
    summaryExpectation,
    { temperature: 0.1, cheap: true }, // Use cheap model for validation
  );

  expect(
    isSummaryValid,
    `Conversation summary "${summaryText}" should meet expectations: ${summaryExpectation.description}`,
  ).toBe(true);
  const wordCount = summaryText.split(' ').filter((word) => word.length > 0).length;
  expect(wordCount, `Summary word count (${wordCount}) should be <= ${maxWords}`).toBeLessThanOrEqual(maxWords);
}

describe.each([
  { model: 'Gemini Flash', generateContent: generateContentAiStudio, modelType: ModelType.CHEAP },
  { model: 'Claude Haiku', generateContent: generateContentAnthropic, modelType: ModelType.CHEAP },
  { model: 'GPT-4o Mini', generateContent: generateContentOpenAI, modelType: ModelType.CHEAP },
  // Add more capable models if needed, adjust modelType accordingly
  // { model: 'Gemini 1.5 Pro', generateContent: generateContentAiStudio, modelType: ModelType.DEFAULT },
  // { model: 'Claude 3.5 Sonnet', generateContent: generateContentAnthropic, modelType: ModelType.DEFAULT },
  // { model: 'GPT-4o\t', generateContent: generateContentOpenAI, modelType: ModelType.DEFAULT },
])('conversation-summary eval: $model', ({ generateContent: originalGenerateContent, modelType }) => {
  let generateContent: GenerateContentFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    generateContent = retryGenerateContent(originalGenerateContent);
  });

  it('should summarize a simple refactoring request', async () => {
    const userPromptText =
      'I need to refactor the user authentication module in `auth.service.ts` to use OAuth2 instead of basic auth.';
    const conversationHistory: PromptItem[] = [
      ...createConversationPrefix(),
      { type: 'user', text: userPromptText },
      // Note: The assistant ack and user summary request are now handled by prepareSummaryPrompt
    ];

    const summaryExpectation: LLMContentExpectation = {
      description: 'A concise summary (max 10 words) of the user request to refactor auth module to OAuth2.',
      requiredElements: ['refactor', 'authentication', 'OAuth2', 'auth.service.ts'],
      forbiddenElements: ['greeting', 'source code details', 'unrelated topics', 'assistant ack'], // Max 10 words enforced by prepareSummaryPrompt
      tone: 'technical',
    };

    await runSummaryTest(generateContent, modelType, conversationHistory, summaryExpectation, 10); // Use 10 for maxWords as per prepareSummaryPrompt
  });

  it('should summarize after multi-turn clarification', async () => {
    const conversationHistory: PromptItem[] = [
      ...createConversationPrefix(),
      { type: 'user', text: 'Update the UI component.' },
      { type: 'assistant', text: 'Which UI component are you referring to? Please specify the file path.' },
      {
        type: 'user',
        text: 'Oh, sorry. I mean `/Users/gtanczyk/src/genaicode/src/main/ui/frontend/app/components/chat/message-container.tsx`.',
      },
      { type: 'assistant', text: 'Got it. And what specific update do you want to make to `message-container.tsx`?' },
      { type: 'user', text: 'Add a timestamp next to each message.' },
      {
        type: 'assistant',
        text: 'Okay, adding timestamps to messages in `message-container.tsx`. I can proceed with that.',
      },
    ];

    const summaryExpectation: LLMContentExpectation = {
      description: 'A concise summary (max 10 words) of the final task: adding timestamps to message-container.tsx.',
      requiredElements: ['timestamp', 'message-container.tsx', 'add'],
      forbiddenElements: ['initial vague request', 'UI component', 'greeting', 'source code'],
      tone: 'technical',
    };

    await runSummaryTest(generateContent, modelType, conversationHistory, summaryExpectation, 10);
  });

  it('should summarize a debugging request', async () => {
    const conversationHistory: PromptItem[] = [
      ...createConversationPrefix(),
      {
        type: 'user',
        text: "I am getting a `TypeError: Cannot read property 'data' of undefined` in `api-client.ts` when fetching user profiles.",
      },
      {
        type: 'assistant',
        text: 'Okay, let me look into that. Can you show me the relevant code block in `api-client.ts`?',
      },
      {
        type: 'user',
        text: 'Sure, it is the `fetchUserProfile` function. It seems the response object is sometimes empty.',
      },
      {
        type: 'assistant',
        text: 'Thanks. It might be an issue with error handling or the API endpoint itself. I can try to add better error checking.',
      },
    ];

    const summaryExpectation: LLMContentExpectation = {
      description:
        'A concise summary (max 10 words) of the debugging task: fixing a TypeError in api-client.ts fetchUserProfile.',
      requiredElements: ['TypeError', 'api-client.ts', 'fetchUserProfile', 'fix', 'debug'], // Allow 'fix' or 'debug'
      forbiddenElements: ['greeting', 'source code', 'solution details'],
      tone: 'problem description',
    };

    await runSummaryTest(generateContent, modelType, conversationHistory, summaryExpectation, 10);
  });

  it('should summarize a longer conversation involving code changes', async () => {
    const conversationHistory: PromptItem[] = [
      ...createConversationPrefix(),
      { type: 'user', text: 'I want to improve the performance of the `find-files.ts` module.' },
      { type: 'assistant', text: 'Okay, what specific performance improvements are you considering?' },
      {
        type: 'user',
        text: 'I think we can optimize the glob pattern matching and perhaps use asynchronous iteration.',
      },
      {
        type: 'assistant',
        text: 'That sounds reasonable. Using `fast-glob` might help, and `Symbol.asyncIterator` could be beneficial for large directories.',
      },
      { type: 'user', text: 'Exactly. Let us try implementing those changes in `find-files.ts`.' },
      {
        type: 'assistant',
        text: 'Alright, I will start by modifying `find-files.ts` to use `fast-glob` and async iteration.',
        // Simulate a potential function call if the assistant were to start coding
        // functionCalls: [{ name: 'updateFile', args: { filePath: '/Users/gtanczyk/src/genaicode/src/files/find-files.ts', ... } }]
      },
      {
        type: 'user',
        text: 'Hold on, before you start, also make sure to update the related tests in `file-utils.test.ts`.',
      },
      { type: 'assistant', text: 'Good point! I will update `find-files.ts` and `file-utils.test.ts` accordingly.' },
    ];

    const summaryExpectation: LLMContentExpectation = {
      description:
        'A concise summary (max 10 words) of the task: optimizing find-files.ts performance using fast-glob/async iteration and updating tests.',
      requiredElements: [
        'optimize',
        'performance',
        'find-files.ts',
        'fast-glob',
        'async iteration',
        'tests',
        'file-utils.test.ts',
      ],
      forbiddenElements: ['greeting', 'initial discussion points', 'source code'],
      tone: 'technical planning',
    };

    // Even though the original request asked for 20 words, prepareSummaryPrompt uses 10.
    // The test expectation description remains detailed, but the length check aligns with the function.
    await runSummaryTest(generateContent, modelType, conversationHistory, summaryExpectation, 10);
  });

  it('should summarize a difficult case with ambiguity, context switching, and multiple changes', async () => {
    const conversationHistory: PromptItem[] = [
      ...createConversationPrefix(),
      {
        type: 'user',
        text: "I need to fix something in the data processing and also the output formatting. It's related to the new customer IDs.",
      },
      {
        type: 'assistant',
        text: "Okay, I understand you're working with new customer IDs and need to address issues in data processing and output formatting. To help me understand better, could you specify which files are involved? Are we talking about `data_processor.py` and `output_formatter.py`?",
      },
      {
        type: 'user',
        text: 'Yes, exactly those two files. In `data_processor.py`, the customer ID validation needs to be updated to handle the new ID format, which is alphanumeric now. And in `output_formatter.py`, the report generation function needs to display the full alphanumeric ID, not just the numeric part it was showing before.',
      },
      {
        type: 'assistant',
        text: 'Right, so in `data_processor.py`, you need to modify the validation logic in `validate_customer_id` function to accommodate alphanumeric IDs. And in `output_formatter.py`, within the `generate_report` function, you need to ensure the full customer ID is displayed. Is there anything else related to these changes?',
      },
      {
        type: 'user',
        text: "Actually, yes. In `data_processor.py`, after validation, we also need to store the *type* of customer ID (e.g., 'numeric' or 'alphanumeric') along with the ID itself. This type information will be needed by `output_formatter.py` later to format the report correctly based on ID type, even though for now just showing the full ID is enough. But please add the type storage in `data_processor.py` now itself.",
      },
      {
        type: 'assistant',
        text: 'Okay, I understand. I will update the ID validation in `data_processor.py`, add storage for the ID type there, and update `output_formatter.py` to display the full ID.',
      }, // Assistant acknowledges the final plan
    ];

    const summaryExpectation: LLMContentExpectation = {
      description:
        'A concise summary (max 10 words) capturing updates to ID validation and output across two files for new customer IDs.',
      requiredElements: ['ID', 'validation', 'output', 'data_processor.py', 'output_formatter.py', 'customer IDs'], // Ensure key elements are mentioned
      forbiddenElements: [
        'initial ambiguity',
        'fix something',
        'report generation function',
        'validate_customer_id',
        'greeting',
        'source code',
      ], // Avoid overly specific details or vague terms
      tone: 'technical', // Summary should be technical and concise
    };

    // The expected summary should be something like: "Update ID validation and output for new customer IDs in two files."
    // or "Modify data_processor.py and output_formatter.py for new customer IDs."
    await runSummaryTest(generateContent, modelType, conversationHistory, summaryExpectation, 10);
  });
});
