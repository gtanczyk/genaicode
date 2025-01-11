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
import { LLMContentExpectation, validateLLMContent, verifyFileUpdates, verifyContextPaths } from './test-utils.js';
import { CodegenSummaryArgs } from '../main/codegen-types.js';
import { validateAndRecoverSingleResult } from '../prompt/steps/step-validate-recover.js';

vi.setConfig({
  testTimeout: 60000,
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
      expectedTools: ['updateFile'],
      expectedContextPaths: ['/path/to/file/translator.ts'],
      promptExpectation: {
        description: 'Update example.ts to use translator for Japanese translation',
        requiredElements: ['translator integration', 'Japanese translation', 'dynamic output'],
        tone: 'technical',
      } as LLMContentExpectation,
      explanationExpectation: {
        description: 'Explain the changes needed for Japanese translation',
        requiredElements: ['translator usage', 'file modifications or updates', 'integration details'],
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
      expectedTools: ['updateFile'],
      expectedContextPaths: [
        '/project/src/todo-app/tasks/task-manager.ts',
        '/project/src/todo-app/frontend/components/tasks/task-list.tsx',
        '/project/src/todo-app/tasks/task-types.ts',
      ],
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
      explanationExpectation: {
        description: 'Explain the implementation of PDF export feature',
        requiredElements: ['component modifications', 'PDF generation logic', 'user interface changes', 'data flow'],
        tone: 'technical',
      } as LLMContentExpectation,
    },
  ])(
    '$description',
    async ({
      userPrompt,
      rootDir,
      sourceCode,
      expectedFiles,
      expectedTools,
      expectedContextPaths,
      promptExpectation,
      explanationExpectation,
    }) => {
      const prompt: PromptItem[] = [
        {
          type: 'systemPrompt',
          systemPrompt: getSystemPrompt(
            {
              rootDir,
            },
            { askQuestion: false },
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

      const codegenSummary = functionCalls.find(
        (call) => call.name === 'codegenSummary',
      ) as FunctionCall<CodegenSummaryArgs>;
      console.log('Codegen Summary:', JSON.stringify(codegenSummary?.args, null, 2));

      expect(codegenSummary!.args).toBeDefined();

      // Verify deterministic parts
      const { fileUpdates, contextPaths, explanation } = codegenSummary!.args!;

      // Verify file paths and update tools
      verifyFileUpdates(fileUpdates, expectedFiles, expectedTools);

      // Verify context paths
      verifyContextPaths(contextPaths, expectedContextPaths);

      // Verify LLM-generated content
      for (const fileUpdate of fileUpdates) {
        const isValid = await validateLLMContent(generateContent, fileUpdate.prompt, promptExpectation, {
          temperature: 0.1,
          cheap: true,
        });
        expect(isValid, `File update prompt for "${fileUpdate.filePath}" should meet expectations`).toBe(true);
      }

      const isExplanationValid = await validateLLMContent(generateContent, explanation, explanationExpectation, {
        temperature: 0.1,
        cheap: true,
      });
      expect(isExplanationValid, 'Explanation should meet expectations').toBe(true);
    },
  );
});
