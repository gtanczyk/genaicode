import fs from 'fs';
import mime from 'mime-types';
import { describe, it, expect, vi } from 'vitest';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentOpenAI } from '../ai-service/openai.js';
import {
  INITIAL_GREETING,
  READY_TO_ASSIST,
  REQUEST_SOURCE_CODE,
  SOURCE_CODE_RESPONSE,
} from '../prompt/static-prompts.js';
import { getSystemPrompt } from '../prompt/systemprompt.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import { PromptImageMediaType, PromptItem } from '../ai-service/common.js';
import { ActionType } from '../prompt/steps/step-ask-question/step-ask-question-types.js';
import { MOCK_SOURCE_CODE_SUMMARIES_LARGE } from './data/mock-source-code-summaries-large.js';
import { MOCK_SOURCE_CODE_CONTENTS_LARGE } from './data/mock-source-code-contents-large.js';
import { retryGenerateContent } from './test-utils/generate-content-retry.js';
import { validateAndRecoverSingleResult } from '../prompt/steps/step-validate-recover.js';

vi.setConfig({
  testTimeout: 3 * 60000,
});

describe.each([
  { model: 'Gemini Flash', generateContent: generateContentAiStudio, cheap: true },
  { model: 'Claude Haikku', generateContent: generateContentAnthropic, cheap: true },
  { model: 'GPT-4o Mini', generateContent: generateContentOpenAI, cheap: true },
])('Ask Question: $model', ({ generateContent, cheap }) => {
  generateContent = retryGenerateContent(generateContent);

  it.each([
    {
      name: 'hello prompt',
      userMessage: 'hello',
      expectedActionType: 'sendMessage' as ActionType,
      expectedMessageContent: expect.stringContaining('Hello'),
      sourceCodeTree: {},
      promptPrefix: [],
    },
    {
      name: 'good bye prompt',
      userMessage: 'good bye',
      expectedActionType: 'endConversation' as ActionType,
      expectedMessageContent: expect.stringContaining('bye'),
      sourceCodeTree: {},
      promptPrefix: [],
    },
    {
      name: 'request files content',
      userMessage: 'what is the code style used in project-manager.ts file',
      expectedActionType: 'requestFilesContent' as ActionType,
      expectedMessageContent: expect.stringContaining('project-manager.ts'),
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      promptPrefix: [],
    },
    {
      name: 'subsequent request files content',
      userMessage: 'what is the code style used in project-manager.ts file',
      expectedActionType: 'sendMessage' as ActionType,
      expectedMessageContent: expect.stringContaining('TypeScript'),
      sourceCodeTree: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      promptPrefix: [
        {
          type: 'user',
          text: 'What is the code style used in project-manager.ts file?',
        },
        {
          type: 'assistant',
          text: 'To assist you with that, I need to see the content of project-manager.ts. Can you provide it?',
          functionCalls: [
            {
              name: 'requestFilesContent',
              args: {
                filePaths: ['/project/src/main/project-manager.ts'],
              },
            },
          ],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'requestFilesContent',
              content: JSON.stringify(MOCK_SOURCE_CODE_CONTENTS_LARGE['/project/src/main/project-manager.ts']),
            },
          ],
          text: 'Here is the content of project-manager.ts',
        },
        {
          type: 'assistant',
          text: 'The code style used in project-manager.ts is consistent with standard JavaScript conventions. It follows common practices for naming, indentation, and formatting.',
        },
      ] as PromptItem[],
    },
    {
      name: 'generate an image',
      userMessage:
        'can you generate a background image for my website? it should blue background with sun and clouds and 1024x1024 dimensions',
      expectedActionType: 'generateImage' as ActionType,
      expectedMessageContent: expect.stringContaining('background image'),
      promptPrefix: [],
    },
    {
      name: 'analyze an image',
      expectedActionType: 'sendMessage' as ActionType,
      expectedMessageContent: expect.stringContaining('star'),
      promptPrefix: [
        {
          type: 'user',
          text: 'what do you see on this image',
          images: [
            {
              base64url: fs.readFileSync('./src/eval/data/testimage.png', 'base64'),
              mediaType: (mime.lookup('./src/eval/data/testimage.png') || '') as PromptImageMediaType,
            },
          ],
        },
      ] as PromptItem[],
    },
    {
      name: 'count objects on an image',
      expectedActionType: 'performAnalysis' as ActionType,
      expectedMessageContent: expect.stringContaining('analyze'),
      promptPrefix: [
        {
          type: 'user',
          text: 'count stars this image',
          images: [
            {
              base64url: fs.readFileSync('./src/eval/data/testimage.png', 'base64'),
              mediaType: (mime.lookup('./src/eval/data/testimage.png') || '') as PromptImageMediaType,
            },
          ],
        },
      ] as PromptItem[],
    },
    {
      name: 'updateFile without context',
      userMessage: 'Please update /project/src/missing-file.ts',
      expectedActionType: 'requestFilesContent',
      expectedMessageContent: expect.stringContaining('/project/src/missing-file.ts'),
      sourceCodeTree: {
        ...MOCK_SOURCE_CODE_SUMMARIES_LARGE,
        '/project/src/missing-file.ts': {
          summary: 'This file contains important calculations',
        },
      },
      promptPrefix: [],
    },
    {
      name: 'createFile for existing file',
      userMessage: 'Create a new file at /project/src/todo-app/existing-file.ts with example console log',
      expectedActionType: 'sendMessage',
      expectedMessageContent: expect.stringContaining('already exists'),
      sourceCodeTree: {
        ...MOCK_SOURCE_CODE_SUMMARIES_LARGE,
        '/project/src/todo-app/existing-file.ts': {
          content: 'console.log("Hello, World!");',
        },
      },
      promptPrefix: [],
    },
    {
      name: 'createFile for non existing file',
      userMessage: 'Create a new file at /project/src/todo-app/new-file.ts with example console log',
      expectedActionType: 'createFile',
      expectedMessageContent: expect.stringContaining('new-file.ts'),
      sourceCodeTree: {
        ...MOCK_SOURCE_CODE_SUMMARIES_LARGE,
        '/project/src/todo-app/other-file.ts': {
          content: 'console.log("Hello, World!");',
        },
      },
      promptPrefix: [],
    },
    {
      name: 'genaicode help',
      userMessage: 'how to generate images in genaicode?',
      expectedActionType: 'genaicodeHelp',
      promptPrefix: [],
    },
  ])('$name', async ({ userMessage, expectedActionType, expectedMessageContent, sourceCodeTree, promptPrefix }) => {
    // Prepare prompt items for testing
    const prompt: PromptItem[] = [
      {
        type: 'systemPrompt',
        systemPrompt: getSystemPrompt(
          { rootDir: '/project' },
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
      ...promptPrefix,
    ];

    if (userMessage) {
      prompt.push({
        type: 'user',
        text: userMessage,
      });
    }

    // Execute ask question step
    const temperature = 0.2;
    const result = await generateContent(prompt, getFunctionDefs(), 'askQuestion', temperature, cheap);
    const [askQuestionCall] = await validateAndRecoverSingleResult(
      [prompt, getFunctionDefs(), 'askQuestion', temperature, cheap],
      result,
      generateContent,
    );

    // Log the askQuestion call for debugging
    console.log(JSON.stringify(askQuestionCall.args, null, 2));

    // Verify the response
    expect(askQuestionCall).toBeDefined();
    expect(askQuestionCall.name).toBe('askQuestion');
    expect(askQuestionCall.args).toBeDefined();
    expect(askQuestionCall.args!.actionType).toBe(expectedActionType);
    if (expectedMessageContent) {
      expect(askQuestionCall.args!.message).toEqual(expectedMessageContent);
    }

    // Verify decision making process is present and meaningful
    expect(askQuestionCall.args!.decisionMakingProcess).toBeDefined();
    expect(askQuestionCall.args!.decisionMakingProcess).toContain('Contextual Analysis');
    expect(askQuestionCall.args!.decisionMakingProcess).toContain('Options Evaluation');
    expect(askQuestionCall.args!.decisionMakingProcess).toContain('Decision Justification');
  });
});
