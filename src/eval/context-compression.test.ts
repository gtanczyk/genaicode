import { describe, it, expect, vi } from 'vitest';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentOpenAI } from '../ai-service/openai.js';
import { CONTEXT_COMPRESSION_PROMPT } from '../prompt/steps/step-context-compression.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import { PromptItem } from '../ai-service/common-types.js';
import { ModelType } from '../ai-service/common-types.js';
import {
  INITIAL_GREETING,
  READY_TO_ASSIST,
  REQUEST_SOURCE_CODE,
  SOURCE_CODE_RESPONSE,
} from '../prompt/static-prompts.js';
import { MOCK_SOURCE_CODE_SUMMARIES_LARGE } from './data/mock-source-code-summaries-large.js';
import { retryGenerateContent } from './test-utils/generate-content-retry.js';
import { ContextCompressionCall } from '../prompt/function-defs/context-compression.js';
import { validateLLMContent } from './test-utils/llm-content-validate.js';
import { GenerateContentFunction } from '../ai-service/common-types.js';

// Helper function to validate compressed context
async function validateCompressedContext(
  generateContent: GenerateContentFunction,
  result: ContextCompressionCall,
  {
    summaryExpectation,
    expectedFiles = [],
  }: {
    summaryExpectation: {
      description: string;
      requiredElements: string[];
      forbiddenElements?: string[];
      tone?: string;
    };
    expectedFiles?: string[];
  },
): Promise<void> {
  expect(result.args).toBeDefined();

  // Validate conversation summary
  const summaryValid = await validateLLMContent(generateContent, result.args!.conversationSummary, summaryExpectation, {
    cheap: true,
  });

  // Assert the result
  expect.soft(summaryValid).toBe(true);
  expect.soft(result.args!.filePaths).toEqual(expectedFiles.length > 0 ? expect.arrayContaining(expectedFiles) : []);
}

vi.setConfig({
  testTimeout: 3 * 60000,
});

describe.each([
  { model: 'Gemini Flash', generateContent: generateContentAiStudio, modelType: ModelType.CHEAP },
  { model: 'Claude Haikku', generateContent: generateContentAnthropic, modelType: ModelType.CHEAP },
  { model: 'GPT-4o Mini', generateContent: generateContentOpenAI, modelType: ModelType.CHEAP },
])('Context compression: $model', ({ generateContent, modelType }) => {
  generateContent = retryGenerateContent(generateContent);

  it.each([
    {
      name: 'simple conversation without code references',
      prompt: [
        {
          type: 'user',
          text: 'Hello there!',
        },
        {
          type: 'assistant',
          text: 'Hi! How can I help you today?',
        },
      ] as PromptItem[],
      validate: (result: ContextCompressionCall) =>
        validateCompressedContext(generateContent, result, {
          summaryExpectation: {
            description: 'A concise summary of a greeting conversation',
            requiredElements: ['greeting', 'initial interaction'],
            forbiddenElements: ['code', 'implementation', 'file'],
            tone: 'neutral',
          },
        }),
    },
    {
      name: 'conversation with file references',
      prompt: [
        {
          type: 'user',
          text: 'I want to update the validation logic in validation-utils.ts',
        },
        {
          type: 'assistant',
          text: 'I will help you with that. Let me check the current implementation.',
          functionCalls: [{ name: 'getSourceCode' }],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify({
                '/project/src/todo-app/utils/validation-utils.ts': {
                  content: 'export function validate() { /* implementation */ }',
                },
                '/project/src/todo-app/utils/api-utils.ts': {
                  content: 'import { validate } from "./validation-utils";',
                },
              }),
            },
          ],
        },
      ] as PromptItem[],
      validate: (result: ContextCompressionCall) =>
        validateCompressedContext(generateContent, result, {
          summaryExpectation: {
            description: 'A summary of a conversation about updating validation logic',
            requiredElements: ['validation', 'update', 'implementation'],
            tone: 'technical',
          },
          expectedFiles: [
            '/project/src/todo-app/utils/validation-utils.ts',
            '/project/src/todo-app/utils/api-utils.ts',
          ],
        }),
    },
    {
      name: 'complex conversation with multiple topics',
      prompt: [
        {
          type: 'user',
          text: 'Need to improve error handling in the application',
        },
        {
          type: 'assistant',
          text: 'I will analyze the current error handling implementation.',
          functionCalls: [{ name: 'getSourceCode' }],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify(MOCK_SOURCE_CODE_SUMMARIES_LARGE),
            },
          ],
        },
        {
          type: 'assistant',
          text: 'I see several areas where we can improve error handling.',
        },
        {
          type: 'user',
          text: "Let's focus on the API error handling first.",
        },
      ] as PromptItem[],
      validate: (result: ContextCompressionCall) =>
        validateCompressedContext(generateContent, result, {
          summaryExpectation: {
            description: 'A summary of a conversation about improving error handling',
            requiredElements: ['error handling', 'API', 'improvement'],
            tone: 'technical',
          },
          expectedFiles: ['/project/src/todo-app/api/api-manager.ts'],
        }),
    },
    {
      name: 'conversation with code review',
      prompt: [
        {
          type: 'user',
          text: 'Can you review the authentication implementation?',
        },
        {
          type: 'assistant',
          text: 'I will review the authentication code for potential issues.',
          functionCalls: [{ name: 'getSourceCode' }],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify({
                '/project/src/auth/authentication.ts': {
                  content: 'export class Authentication { /* implementation */ }',
                },
              }),
            },
          ],
        },
        {
          type: 'assistant',
          text: 'I found several potential security issues:\n1. Weak password validation\n2. Missing rate limiting',
        },
        {
          type: 'user',
          text: "Let's fix these issues.",
        },
      ] as PromptItem[],
      validate: (result: ContextCompressionCall) =>
        validateCompressedContext(generateContent, result, {
          summaryExpectation: {
            description: 'A summary of a conversation about authentication security review',
            requiredElements: ['authentication', 'security', 'review', 'issues'],
            tone: 'technical',
          },
          expectedFiles: ['/project/src/auth/authentication.ts'],
        }),
    },
    {
      name: 'conversation about new feature implementation',
      prompt: [
        {
          type: 'user',
          text: 'We need to add support for task categories',
        },
        {
          type: 'assistant',
          text: 'I will help you implement task categories. First, let me check the current task implementation.',
          functionCalls: [{ name: 'getSourceCode' }],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify(MOCK_SOURCE_CODE_SUMMARIES_LARGE),
            },
          ],
        },
        {
          type: 'assistant',
          text: "I see. We'll need to modify several files to add category support.",
        },
      ] as PromptItem[],
      validate: (result: ContextCompressionCall) =>
        validateCompressedContext(generateContent, result, {
          summaryExpectation: {
            description: 'A summary of a conversation about implementing task categories',
            requiredElements: ['task categories', 'implementation', 'feature'],
            tone: 'technical',
          },
          expectedFiles: ['/project/src/todo-app/tasks/task-manager.ts'],
        }),
    },
  ])('$name', async ({ prompt, validate }) => {
    // Prepare the test prompt
    const testPrompt: PromptItem[] = [
      { type: 'systemPrompt', systemPrompt: CONTEXT_COMPRESSION_PROMPT },
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
      ...prompt,
    ];

    // Execute context compression
    const [compressContextCall] = (await generateContent(
      testPrompt,
      getFunctionDefs(),
      'compressContext',
      0.3,
      modelType,
    )) as [ContextCompressionCall | undefined];

    // Log the result for debugging
    console.log(JSON.stringify(compressContextCall, null, 2));

    // Verify the response
    expect(compressContextCall).toBeDefined();
    expect(compressContextCall!.name).toBe('compressContext');

    // Validate the content
    await validate(compressContextCall!);
  });
});
