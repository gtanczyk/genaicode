import { describe, it, expect, vi } from 'vitest';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentOpenAI } from '../ai-service/openai.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import { PromptItem } from '../ai-service/common-types.js';
import { ModelType } from '../ai-service/common-types.js';
import { getSystemPrompt } from '../prompt/systemprompt.js';
import { MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR } from './data/mock-source-code-summaries-large.js';
import {
  getPartialPromptTemplate,
  INITIAL_GREETING,
  READY_TO_ASSIST,
  REQUEST_SOURCE_CODE,
  SOURCE_CODE_RESPONSE,
} from '../prompt/static-prompts.js';
import {
  CODEGEN_SUMMARY_APPROVED,
  CODEGEN_SUMMARY_GENERATED_MESSAGE,
} from '../prompt/steps/step-ask-question/handlers/handle-code-generation.js';
import { MOCK_SOURCE_CODE_CONTENTS_LARGE } from './data/mock-source-code-contents-large.js';
import { retryGenerateContent } from './test-utils/generate-content-retry.js';
import { updateServiceConfig } from '../ai-service/service-configurations.js';

vi.setConfig({
  testTimeout: 3 * 60000,
});

describe.each([
  {
    model: 'Gemini Pro',
    generateContent: generateContentAiStudio,
    serviceConfigUpdate: [
      'ai-studio',
      {
        modelOverrides: {
          default: 'gemini-1.5-pro',
        },
      },
    ] as Parameters<typeof updateServiceConfig>,
  },
  { model: 'Claude Sonnet', generateContent: generateContentAnthropic },
  {
    model: 'Claude Sonnet 3.7',
    generateContent: generateContentAnthropic,
    serviceConfigUpdate: [
      'anthropic',
      {
        modelOverrides: {
          default: 'claude-3-7-sonnet-20250219',
        },
      },
    ] as Parameters<typeof updateServiceConfig>,
  },
  { model: 'GPT-4o', generateContent: generateContentOpenAI },
])('Code Generation: $model', ({ generateContent, serviceConfigUpdate }) => {
  if (serviceConfigUpdate) {
    updateServiceConfig(...serviceConfigUpdate);
  }
  generateContent = retryGenerateContent(generateContent);

  it.each([
    {
      name: 'simple code change',
      userPrompt: 'I want to add a copy project feature to the application.',
      contentMatcher: expect.stringContaining('copyProject('),
    },
    {
      name: 'keep existing code',
      userPrompt: 'add some jsdoc comments to the project-manager.ts file',
      contentMatcher: expect.stringContaining('this.projects = this.projects.filter((p) => p !== project);'),
    },
  ])('$name', async ({ userPrompt, contentMatcher }) => {
    // Mock data for codegenPlanning and codegenSummary
    const codegenPlanning = {
      problemAnalysis: 'The user wants to add a new feature to the application.',
      codeChanges: 'We need to update the file to include the new feature.',
      affectedFiles: [
        {
          reason: 'This file needs to be updated to include the new feature.',
          filePath: '/project/src/main/project-manager.ts',
          dependencies: [],
        },
      ],
    };

    const codegenSummary = {
      fileUpdates: [
        {
          filePath: '/project/src/main/project-manager.ts',
          updateToolName: 'updateFile',
          prompt: 'Update the file to include the new feature.',
          temperature: 0.2,
          cheap: false,
        },
      ],
    };

    // Prepare prompt items for testing
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
            vision: true,
            imagen: 'vertex-ai',
            aiService: 'vertex-ai',
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
            content: JSON.stringify(MOCK_SOURCE_CODE_CONTENTS_LARGE),
          },
        ],
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
        functionCalls: [
          {
            name: 'codegenPlanning',
            args: codegenPlanning,
          },
        ],
      },
      {
        type: 'user',
        text: 'Continue',
        functionResponses: [
          {
            name: 'codegenPlanning',
            content: JSON.stringify({}),
          },
        ],
      },
      {
        type: 'assistant',
        text: CODEGEN_SUMMARY_GENERATED_MESSAGE,
        functionCalls: [
          {
            name: 'codegenSummary',
            args: codegenSummary,
          },
        ],
      },
      {
        type: 'user',
        text: CODEGEN_SUMMARY_APPROVED,
        functionResponses: [
          {
            name: 'codegenSummary',
            content: JSON.stringify({}),
          },
        ],
      },
      {
        type: 'user',
        text: getPartialPromptTemplate(codegenSummary.fileUpdates[0]),
      },
    ];

    // Execute processFileUpdates
    const functionCalls = await generateContent(
      prompt,
      getFunctionDefs(),
      codegenSummary.fileUpdates[0].updateToolName,
      0.2,
      ModelType.DEFAULT,
    );

    // Verify the response
    expect(functionCalls).toBeDefined();
    expect(functionCalls.length).toBeGreaterThan(0);

    const updateFileCall = functionCalls.find((call) => call.name === codegenSummary.fileUpdates[0].updateToolName);
    console.log(JSON.stringify(updateFileCall, null, 2));
    expect(updateFileCall).toBeDefined();
    expect(updateFileCall?.args).toBeDefined();
    expect(updateFileCall?.args?.filePath).toBe('/project/src/main/project-manager.ts');
    expect(updateFileCall?.args?.newContent).toBeDefined();
    expect(updateFileCall?.args?.newContent).toEqual(contentMatcher);
  });
});
