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
import { retryGenerateContent } from './test-utils/generate-content-retry.js';

vi.setConfig({
  testTimeout: 3 * 60000,
});

describe.each([
  { model: 'Gemini Flash', generateContent: generateContentAiStudio, cheap: true },
  { model: 'Claude Haikku', generateContent: generateContentAnthropic, cheap: true },
  { model: 'GPT-4o Mini', generateContent: generateContentOpenAI, cheap: true },
])('Context optimization: $model', ({ generateContent, cheap }) => {
  generateContent = retryGenerateContent(generateContent);

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
    {
      dataset: 'large',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      userMessage: 'hello there!',
      expectedOptimizedFiles: [],
      optionalOptimizedFiles: [],
    },
    {
      dataset: 'large',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      userMessage: 'need to convert all files to plain javascript',
      expectedOptimizedFiles: [],
      optionalOptimizedFiles: [
        '/project/src/todo-app/frontend/components/app.tsx',
        '/project/src/todo-app/api/api-manager.ts',
        '/project/src/todo-app/auth/user-auth.ts',
        '/project/src/todo-app/tasks/task-manager.ts',
        '/project/src/todo-app/frontend/utils/api-client.ts',
      ],
    },
    {
      dataset: 'large',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      userMessage: 'hey, we need to work on the login flow e2e, can you explain how it works currently?',
      expectedOptimizedFiles: [
        '/project/src/todo-app/auth/user-auth.ts',
        '/project/src/todo-app/auth/login.ts',
        '/project/src/todo-app/frontend/components/auth/login-form.tsx',
        '/project/src/todo-app/api/auth-routes.ts',
      ],
      optionalOptimizedFiles: [
        '/project/src/todo-app/auth/session-management.ts',
        '/project/src/todo-app/frontend/utils/api-client.ts',
        '/project/src/todo-app/utils/security-utils.ts',
        '/project/src/todo-app/utils/validation-utils.ts',
        '/project/src/todo-app/api/api-manager.ts',
        '/project/src/todo-app/database/user-db.ts',
      ],
    },
    {
      dataset: 'large',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      userMessage: 'I want to add a due date field to the task creation form.',
      expectedOptimizedFiles: [
        '/project/src/todo-app/frontend/components/tasks/task-list.tsx',
        '/project/src/todo-app/frontend/components/tasks/task-item.tsx',
        '/project/src/todo-app/tasks/create-task.ts',
        '/project/src/todo-app/tasks/task-manager.ts',
      ],
      optionalOptimizedFiles: [
        '/project/src/todo-app/api/task-routes.ts',
        '/project/src/todo-app/database/task-db.ts',
        '/project/src/todo-app/frontend/components/app.tsx',
        '/project/src/todo-app/utils/validation-utils.ts',
        '/project/src/todo-app/frontend/utils/api-client.ts',
      ],
    },
    {
      dataset: 'large',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      userMessage: 'How does user authentication work in this app?',
      expectedOptimizedFiles: [
        '/project/src/todo-app/auth/user-auth.ts',
        '/project/src/todo-app/auth/login.ts',
        '/project/src/todo-app/auth/registration.ts',
        '/project/src/todo-app/auth/session-management.ts',
      ],
      optionalOptimizedFiles: [
        '/project/src/todo-app/utils/security-utils.ts',
        '/project/src/todo-app/database/user-db.ts',
        '/project/src/todo-app/frontend/components/auth/login-form.tsx',
        '/project/src/todo-app/frontend/components/auth/registration-form.tsx',
        '/project/src/todo-app/api/auth-routes.ts',
      ],
    },
    {
      dataset: 'large',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      userMessage: 'I need to change the color scheme of the app to a dark theme.',
      expectedOptimizedFiles: [
        '/project/src/todo-app/frontend/components/app.tsx',
        '/project/src/todo-app/frontend/components/auth/login-form.tsx',
        '/project/src/todo-app/frontend/components/auth/registration-form.tsx',
        '/project/src/todo-app/frontend/components/projects/project-item.tsx',
        '/project/src/todo-app/frontend/components/projects/project-list.tsx',
        '/project/src/todo-app/frontend/components/settings/settings-form.tsx',
        '/project/src/todo-app/frontend/components/tasks/task-item.tsx',
        '/project/src/todo-app/frontend/components/tasks/task-list.tsx',
      ],
      optionalOptimizedFiles: [],
    },
    {
      dataset: 'large',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      userMessage: "Fix the bug where deleting a project doesn't remove its associated tasks.",
      expectedOptimizedFiles: [
        '/project/src/todo-app/projects/project-manager.ts',
        '/project/src/todo-app/tasks/task-manager.ts',
        '/project/src/todo-app/database/project-db.ts',
        '/project/src/todo-app/database/task-db.ts',
      ],
      optionalOptimizedFiles: [
        '/project/src/todo-app/projects/delete-project.ts',
        '/project/src/todo-app/api/project-routes.ts',
        '/project/src/todo-app/utils/db-utils.ts',
      ],
    },
    {
      dataset: 'large',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      userMessage: 'Integrate Google Calendar to allow syncing tasks with deadlines.',
      expectedOptimizedFiles: [
        '/project/src/todo-app/integrations/google-calendar.ts',
        '/project/src/todo-app/integrations/integration-manager.ts',
        '/project/src/todo-app/tasks/task-manager.ts',
        '/project/src/todo-app/database/integration-db.ts',
      ],
      optionalOptimizedFiles: [
        '/project/src/todo-app/utils/integration-utils.ts',
        '/project/src/todo-app/tasks/create-task.ts',
        '/project/src/todo-app/tasks/update-task.ts',
        '/project/src/todo-app/database/task-db.ts',
        '/project/src/todo-app/frontend/components/tasks/task-list.tsx',
        '/project/src/todo-app/frontend/components/tasks/task-item.tsx',
        '/project/src/todo-app/api/task-routes.ts',
      ],
    },
    {
      dataset: 'large',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      userMessage: 'Generate a report of all completed tasks in the last month.',
      expectedOptimizedFiles: [
        '/project/src/todo-app/reporting/report-manager.ts',
        '/project/src/todo-app/reporting/generate-report.ts',
        '/project/src/todo-app/database/report-db.ts',
        '/project/src/todo-app/utils/report-utils.ts',
        '/project/src/todo-app/database/task-db.ts',
      ],
      optionalOptimizedFiles: ['/project/src/todo-app/tasks/task-manager.ts'],
    },
    {
      dataset: 'large',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      userMessage: 'Optimize the search functionality to provide faster results when searching for tasks.',
      expectedOptimizedFiles: [
        '/project/src/todo-app/api/api-manager.ts',
        '/project/src/todo-app/api/task-routes.ts',
        '/project/src/todo-app/search/search-db.ts',
        '/project/src/todo-app/search/search-manager.ts',
        '/project/src/todo-app/utils/search-utils.ts',
      ],
      optionalOptimizedFiles: [],
    },
    {
      dataset: 'large',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      userMessage: 'Rewrite the entire codebase to use Rust instead of TypeScript.',
      expectedOptimizedFiles: [],
      optionalOptimizedFiles: [],
    },
    {
      dataset: 'large',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      userMessage: 'Refactor the code to improve its maintainability and readability.',
      expectedOptimizedFiles: [],
      optionalOptimizedFiles: [],
    },
    {
      dataset: 'large',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      userMessage: 'Apply a consistent coding style to the entire project',
      expectedOptimizedFiles: [],
      optionalOptimizedFiles: [],
    },
    {
      dataset: 'large',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      userMessage: "Why does changing my notification preferences sometimes seem to affect the app's responsiveness?",
      expectedOptimizedFiles: [
        '/project/src/todo-app/settings/preferences.ts',
        '/project/src/todo-app/settings/user-settings.ts',
        '/project/src/todo-app/notifications/notification-manager.ts',
        '/project/src/todo-app/notifications/send-notification.ts',
        '/project/src/todo-app/database/user-db.ts',
        '/project/src/todo-app/utils/notification-utils.ts',
      ],
      optionalOptimizedFiles: [
        '/project/src/todo-app/notifications/notification-db.ts',
        '/project/src/todo-app/frontend/components/settings/settings-form.tsx',
        '/project/src/todo-app/database/notification-db.ts',
      ],
    },
  ])(
    '$dataset, $userMessage',
    async ({ rootDir, sourceCodeTree, userMessage, expectedOptimizedFiles, optionalOptimizedFiles }) => {
      // Prepare prompt items for optimization
      const prompt: PromptItem[] = [
        {
          type: 'systemPrompt',
          systemPrompt: getSystemPrompt(
            { rootDir },
            {
              askQuestion: true,
              ui: true,
              allowFileCreate: true,
              allowFileDelete: true,
              allowDirectoryCreate: true,
              allowFileMove: true,
              vision: true,
              imagen: 'vertex-ai',
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
      );

      console.log(JSON.stringify(optimizeContextCall.args, null, 2));

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
      expect(optimizedFiles.sort()).toEqual(expect.arrayContaining(expectedOptimizedFiles.sort()));
      expect(
        optimizedFiles.filter(
          (file) => !expectedOptimizedFiles.includes(file) && !optionalOptimizedFiles.includes(file),
        ),
      ).toEqual([]);
    },
  );
});
