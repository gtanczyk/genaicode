import { describe, it, expect, vi } from 'vitest';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentOpenAI } from '../ai-service/openai.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import { FunctionCall, GenerateContentArgs, PromptItem } from '../ai-service/common.js';
import { getSystemPrompt } from '../prompt/systemprompt.js';
import {
  INITIAL_GREETING,
  REQUEST_SOURCE_CODE,
  SOURCE_CODE_RESPONSE,
  READY_TO_ASSIST,
  CODEGEN_SUMMARY_PROMPT,
} from '../prompt/static-prompts.js';
import { PLANNING_PROMPT } from '../prompt/steps/step-codegen-planning.js';
import {
  MOCK_SOURCE_CODE_SUMMARIES_LARGE,
  MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
} from './data/mock-source-code-summaries-large.js';
import { mockComplexAuthSystemContent } from './data/mock-complex-auth-system-content.js';
import { LLMContentExpectation, validateLLMContent, verifyFileUpdates, verifyContextPaths } from './test-utils.js';
import { CodegenSummaryArgs } from '../main/codegen-types.js';
import { validateAndRecoverSingleResult } from '../prompt/steps/step-validate-recover.js';

vi.setConfig({
  testTimeout: 120000,
});

describe.each([
  { model: 'Gemini Pro', generateContent: generateContentAiStudio },
  { model: 'Claude Sonnet', generateContent: generateContentAnthropic },
  { model: 'GPT-4o', generateContent: generateContentOpenAI },
])('codegen-summary: $model', ({ generateContent }) => {
  const temperature = 0.7;

  it.each([
    {
      description: 'simple task',
      userPrompt: 'example.ts should output "Hello" dynamically translated to Japanese',
      rootDir: '/path/to/file',
      sourceCode: JSON.stringify({
        '/path/to/file': {
          'translator.ts': {
            content:
              'import {enToJp} from "magic-translator";\n\nexport function translateToJapanese(text: string): string { return enToJp(text); }',
          },
          'example.ts': {
            content: 'console.log("Hello");',
          },
        },
      }),
      expectedFiles: ['/path/to/file/example.ts'],
      expectedFileUpdates: [
        {
          filePath: '/path/to/file/example.ts',
          tool: 'updateFile',
          promptExpectation: {
            description: 'Update example.ts to use translator for Japanese translation',
            requiredElements: ['translator integration', 'Japanese translation', 'dynamic output'],
            tone: 'technical',
          } as LLMContentExpectation,
        },
      ],
      expectedContextPaths: ['/path/to/file/translator.ts'],
      explanationExpectation: {
        description: 'Explain the changes needed for Japanese translation',
        requiredElements: ['translator usage', 'file modifications/updates/changes'],
        tone: 'technical',
      } as LLMContentExpectation,
    },
    {
      description: 'complex task',
      userPrompt: 'Add a feature to allow users to export their task list as a PDF',
      rootDir: MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR,
      sourceCode: JSON.stringify(MOCK_SOURCE_CODE_SUMMARIES_LARGE),
      expectedFiles: [
        '/project/src/todo-app/tasks/task-manager.ts',
        '/project/src/todo-app/frontend/components/tasks/task-list.tsx',
      ],
      expectedFileUpdates: [
        {
          filePath: '/project/src/todo-app/tasks/task-manager.ts',
          tool: 'updateFile',
          promptExpectation: {
            description: 'Implement PDF export functionality for task lists',
            requiredElements: [
              'PDF generation',
              'export functionality',
              'user interface integration',
              'task data handling',
            ],
            tone: 'technical',
          } as LLMContentExpectation,
        },
        {
          filePath: '/project/src/todo-app/frontend/components/tasks/task-list.tsx',
          tool: 'updateFile',
          promptExpectation: {
            description: 'Implement PDF export functionality for task lists',
            requiredElements: [
              'PDF generation',
              'export functionality',
              'user interface integration',
              'task data handling',
            ],
            tone: 'technical',
          } as LLMContentExpectation,
        },
      ],
      expectedContextPaths: [
        '/project/src/todo-app/tasks/task-manager.ts',
        '/project/src/todo-app/frontend/components/tasks/task-list.tsx',
        '/project/src/todo-app/tasks/task-types.ts',
      ],
      explanationExpectation: {
        description: 'Explain the implementation of PDF export feature',
        requiredElements: ['component modifications', 'PDF generation logic', 'user interface changes', 'data flow'],
        tone: 'technical',
      } as LLMContentExpectation,
    },
    {
      description: 'file creation scenario',
      userPrompt: 'Create a new utility file for string formatting in /utils directory, lets call it string-utils.ts',
      rootDir: '/project/src',
      sourceCode: JSON.stringify({
        '/project/src': {
          'main-module.ts': {
            content: 'console.log("Hello");',
          },
        },
      }),
      expectedFiles: ['/project/src/utils/string-utils.ts'],
      expectedFileUpdates: [
        {
          filePath: '/project/src/utils/string-utils.ts',
          tool: 'createFile',
          promptExpectation: {
            description: 'Create new utility file for string formatting',
            requiredElements: ['string formatting', 'utility functions', 'new file creation'],
            tone: 'technical',
          } as LLMContentExpectation,
        },
        {
          filePath: '/project/src/utils',
          tool: 'createDirectory',
        },
      ],
      expectedContextPaths: ['/project/src/main-module.ts'],
      explanationExpectation: {
        description: 'Explain the creation of new utility file',
        requiredElements: ['utility purpose', 'file structure', 'implementation details'],
        tone: 'technical',
      } as LLMContentExpectation,
    },
    {
      description: 'file deletion scenario',
      userPrompt: 'Remove deprecated-api.ts as it is no longer needed',
      rootDir: '/project/src',
      sourceCode: JSON.stringify({
        '/project/src': {
          'deprecated-api.ts': {
            content: 'export function oldApi() { return "deprecated"; }',
          },
          'new-api.ts': {
            content: 'export function newApi() { return "new"; }',
          },
        },
      }),
      expectedFiles: ['/project/src/deprecated-api.ts'],
      expectedFileUpdates: [
        {
          filePath: '/project/src/deprecated-api.ts',
          tool: 'deleteFile',
          promptExpectation: {
            description: 'Remove deprecated API file and update references',
            requiredElements: ['removal of file that is no longer needed'],
            tone: 'technical',
          } as LLMContentExpectation,
        },
      ],
      expectedContextPaths: [],
      explanationExpectation: {
        description: 'Explain the removal of deprecated API file',
        requiredElements: ['deprecation', 'removal justification'],
        tone: 'technical',
      } as LLMContentExpectation,
    },
    {
      description: 'long explanation scenario',
      userPrompt:
        'Refactor the legacy authentication system to use JWT tokens, addressing all security vulnerabilities. Lets keep the entire implementation in authentication.ts file.',
      rootDir: '/project/src/auth',
      sourceCode: JSON.stringify({
        '/project/src/auth': {
          'authentication.ts': {
            content: mockComplexAuthSystemContent,
          },
        },
      }),
      expectedFiles: ['/project/src/auth/authentication.ts'],
      expectedFileUpdates: [
        {
          filePath: '/project/src/auth/authentication.ts',
          tool: 'updateFile',
          promptExpectation: {
            description: 'Implement secure JWT-based authentication system',
            requiredElements: [
              'JWT token implementation',
              'secure session management',
              'password hashing',
              'proper RBAC implementation',
              'audit logging',
              'security best practices',
              'rate limiting',
              'input validation',
            ],
            forbiddenElements: ['plain text passwords', 'hardcoded credentials', 'predictable session IDs'],
            tone: 'technical',
          } as LLMContentExpectation,
        },
      ],
      expectedContextPaths: ['/project/src/auth/authentication.ts'],
      explanationExpectation: {
        description: 'Provide a comprehensive explanation of the authentication system refactoring',
        requiredElements: [
          'JWT token architecture',
          'security vulnerability remediation',
          'password hashing implementation',
          'session management improvements',
          'RBAC system design',
          'audit logging implementation',
          'rate limiting mechanism',
          'input validation approach',
          'migration strategy',
          'security best practices',
          'breaking changes',
          'backward compatibility considerations',
        ],
        forbiddenElements: ['plain text password storage', 'hardcoded credentials', 'basic role checks'],
        tone: 'technical',
        minLength: 500,
      } as LLMContentExpectation,
    },
  ])(
    '$description',
    async ({
      userPrompt,
      rootDir,
      sourceCode,
      expectedFiles,
      expectedFileUpdates,
      expectedContextPaths,
      explanationExpectation,
    }) => {
      const prompt: PromptItem[] = [
        {
          type: 'systemPrompt',
          systemPrompt: getSystemPrompt(
            {
              rootDir,
            },
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
          functionResponses: [
            {
              name: 'getSourceCode',
              content: sourceCode,
            },
          ],
          text: SOURCE_CODE_RESPONSE,
        },
        {
          type: 'assistant',
          text: READY_TO_ASSIST,
        },
        {
          type: 'user',
          text: userPrompt,
        },
        {
          type: 'assistant',
          text: 'I will generate a plan to achieve this task.',
        },
        { type: 'user', text: PLANNING_PROMPT },
      ];

      // Execute planning phase
      const planningReq = [prompt, getFunctionDefs(), 'codegenPlanning', temperature, false, {}] as GenerateContentArgs;
      let functionCalls = await generateContent(...planningReq);
      functionCalls = await validateAndRecoverSingleResult(planningReq, functionCalls, generateContent, rootDir);

      const codegenPlanning = functionCalls.find((call) => call.name === 'codegenPlanning');
      console.log('Codegen Planning:', JSON.stringify(codegenPlanning?.args, null, 2));

      prompt.push({ type: 'assistant', functionCalls });
      prompt.push(
        {
          type: 'user',
          functionResponses: functionCalls.map((call) => ({ name: call.name, call_id: call.id })),
          text: CODEGEN_SUMMARY_PROMPT,
          cache: true,
        },
        {
          type: 'user',
          text: 'Accept planning and continue',
        },
      );

      // Execute summary phase
      functionCalls = await generateContent(prompt, getFunctionDefs(), 'codegenSummary', temperature, false);
      functionCalls = await validateAndRecoverSingleResult(
        [prompt, getFunctionDefs(), 'codegenSummary', temperature, false, {}],
        functionCalls,
        generateContent,
        rootDir,
      );

      const codegenSummary = functionCalls.find(
        (call) => call.name === 'codegenSummary',
      ) as FunctionCall<CodegenSummaryArgs>;
      console.log('Codegen Summary:', JSON.stringify(codegenSummary?.args, null, 2));

      expect(codegenSummary!.args).toBeDefined();

      // Verify deterministic parts
      const { fileUpdates, contextPaths, explanation } = codegenSummary!.args!;

      // Verify file paths and update tools
      verifyFileUpdates(
        fileUpdates,
        expectedFiles,
        expectedFileUpdates.map((update) => update.tool),
      );

      // Verify context paths
      verifyContextPaths(contextPaths, expectedContextPaths);

      // Verify LLM-generated content for each file update
      for (const fileUpdate of fileUpdates) {
        const expectedUpdate = expectedFileUpdates.find((update) => update.filePath === fileUpdate.filePath);
        if (expectedUpdate && expectedUpdate.promptExpectation) {
          const isValid = await validateLLMContent(
            generateContent,
            fileUpdate.prompt,
            expectedUpdate.promptExpectation,
            {
              temperature: 0.1,
              cheap: true,
            },
          );
          expect(isValid, `File update prompt for "${fileUpdate.filePath}" should meet expectations`).toBe(true);
        }
      }

      const isExplanationValid = await validateLLMContent(generateContent, explanation, explanationExpectation, {
        temperature: 0.1,
        cheap: true,
      });
      expect(isExplanationValid, 'Explanation should meet expectations').toBe(true);
    },
  );
});
