import { describe, it, expect, vi } from 'vitest';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import {
  CONTEXT_OPTIMIZATION_TEMPERATURE,
  OPTIMIZATION_PROMPT,
  OPTIMIZATION_TRIGGER_PROMPT,
} from '../prompt/steps/step-context-optimization.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import { PromptItem } from '../ai-service/common.js';
import { getSystemPrompt } from '../prompt/systemprompt.js';
import { MOCK_SOURCE_CODE_SUMMARIES, MOCK_SOURCE_CODE_SUMMARIES_ROOT_DIR } from './data/mock-source-code-summaries.js';
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
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentOpenAI } from '../ai-service/openai.js';

vi.setConfig({
  testTimeout: 60000,
});

describe.each([
  { model: 'Gemini Flash', generateContent: generateContentAiStudio, cheap: true },
  { model: 'Claude Haikku', generateContent: generateContentAnthropic, cheap: true },
  { model: 'GPT-4o Mini', generateContent: generateContentOpenAI, cheap: true },
])('Context optimization: $model', ({ generateContent, cheap }) => {
  it.each([
    {
      dataset: 'small, math module',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_ROOT_DIR,
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES,
      userMessage: "Let's add a unit test for the math module",
      expectedOptimizedFiles: ['/project/src/math/math.ts', '/project/src/math/math-utils.ts'],
      optionalOptimizedFiles: [],
    },
    {
      dataset: 'large',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      userMessage: 'Lets create unit tests for validation-utils.ts',
      expectedOptimizedFiles: ['/project/src/todo-app/utils/validation-utils.ts'],
      optionalOptimizedFiles: [
        '/project/src/todo-app/utils/api-utils.ts',
        '/project/src/todo-app/utils/db-utils.ts',
        '/project/src/todo-app/utils/security-utils.ts',
        '/project/src/todo-app/auth/user-auth.ts',
        '/project/src/todo-app/auth/login.ts',
        '/project/src/todo-app/auth/registration.ts',
        '/project/src/todo-app/settings/update-profile.ts',
        '/project/src/todo-app/database/user-db.ts',
        '/project/src/todo-app/database/task-db.ts',
        '/project/src/todo-app/database/project-db.ts',
      ],
    },
  ])(
    'Dataset: $dataset',
    async ({ rootDir, sourceCodeTree, userMessage, expectedOptimizedFiles, optionalOptimizedFiles }) => {
      // Prepare prompt items for optimization
      const prompt: PromptItem[] = [
        {
          type: 'systemPrompt',
          systemPrompt: getSystemPrompt({ rootDir }, { aiService: 'ai-studio', askQuestion: true, ui: true }),
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
              content: JSON.stringify(sourceCodeTree),
            },
          ],
        },
        {
          type: 'assistant',
          text: READY_TO_ASSIST,
        },
        {
          type: 'user',
          text: userMessage,
        },
        {
          type: 'assistant',
          text: OPTIMIZATION_TRIGGER_PROMPT,
        },
        {
          type: 'user',
          text: OPTIMIZATION_PROMPT,
        },
      ];

      // Execute context optimization
      const [optimizeContextCall] = await generateContent(
        prompt,
        getFunctionDefs(),
        'optimizeContext',
        CONTEXT_OPTIMIZATION_TEMPERATURE,
        cheap,
        {
          aiService: 'ai-studio',
          askQuestion: false,
        },
      );

      // Verify optimization results
      expect(optimizeContextCall).toBeDefined();
      expect(optimizeContextCall?.args?.optimizedContext).toBeDefined();

      const optimizedContext = optimizeContextCall?.args?.optimizedContext as Array<{
        filePath: string;
        relevance: number;
      }>;
      const optimizedFiles = optimizedContext.sort((a, b) => b.relevance - a.relevance).map((item) => item.filePath);
      const minRelevancy = optimizedContext.reduce((min, item) => Math.min(min, item.relevance), 1);

      expect(minRelevancy).toBeGreaterThanOrEqual(0.5);
      expect(optimizedFiles).toEqual(expect.arrayContaining(expectedOptimizedFiles));
      expect(
        optimizedFiles.filter(
          (file) => !expectedOptimizedFiles.includes(file) && !optionalOptimizedFiles.includes(file),
        ),
      ).toEqual([]);
    },
  );
});
