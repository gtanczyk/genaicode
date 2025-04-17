import fs from 'fs';
import mime from 'mime-types';
import { describe, it, expect, vi } from 'vitest';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentOpenAI } from '../ai-service/openai.js';
import { generateContent as generateContentLocalLllm } from '../ai-service/local-llm.js';
import {
  INITIAL_GREETING,
  READY_TO_ASSIST,
  REQUEST_SOURCE_CODE,
  SOURCE_CODE_RESPONSE,
} from '../prompt/static-prompts.js';
import { getSystemPrompt } from '../prompt/systemprompt.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import { PromptItem } from '../ai-service/common-types.js';
import { PromptImageMediaType } from '../ai-service/common-types.js';
import { ModelType } from '../ai-service/common-types.js';
import { ActionType } from '../prompt/steps/step-ask-question/step-ask-question-types.js';
import { MOCK_SOURCE_CODE_SUMMARIES_LARGE } from './data/mock-source-code-summaries-large.js';
import { MOCK_SOURCE_CODE_CONTENTS_LARGE } from './data/mock-source-code-contents-large.js';
import { retryGenerateContent } from './test-utils/generate-content-retry.js';
import { validateAndRecoverSingleResult } from '../prompt/steps/step-validate-recover.js';
import { generateFileId } from '../files/file-id-utils.js';

vi.setConfig({
  testTimeout: 3 * 60000,
});

describe.each([
  { model: 'Gemini Flash', generateContent: generateContentAiStudio, modelType: ModelType.CHEAP },
  { model: 'Claude Haikku', generateContent: generateContentAnthropic, modelType: ModelType.CHEAP },
  { model: 'GPT-4o Mini', generateContent: generateContentOpenAI, modelType: ModelType.CHEAP },
  { model: 'Local LLM', generateContent: generateContentLocalLllm, modelType: ModelType.CHEAP },
])('Ask Question: $model', ({ generateContent, modelType }) => {
  generateContent = retryGenerateContent(generateContent);

  it.each([
    {
      name: 'hello prompt',
      userMessage: 'hello',
      expectedActionType: 'sendMessage' as ActionType,
      expectedMessageContent: expect.stringContaining('Hello'),
      sourceCode: {},
      promptPrefix: [],
    },
    {
      name: 'good bye prompt',
      userMessage: 'good bye',
      expectedActionType: 'endConversation' as ActionType,
      expectedMessageContent: expect.stringContaining('bye'),
      sourceCode: {},
      promptPrefix: [],
    },
    {
      name: 'request files content',
      userMessage: 'what is the code style used in project-manager.ts file',
      expectedActionType: 'requestFilesContent' as ActionType,
      expectedMessageContent: expect.stringContaining('project-manager.ts'),
      sourceCode: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      promptPrefix: [],
    },
    {
      name: 'subsequent request files content',
      userMessage: 'what is the code style used in project-manager.ts file',
      expectedActionType: 'sendMessage' as ActionType,
      expectedMessageContent: expect.stringContaining('TypeScript'),
      sourceCode: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
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
      expectedMessageContent: expect.stringContaining('nalyz'),
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
      name: 'updateFile without content - should requestFilesContent',
      userMessage: 'Please update /project/src/data-file.ts with copyright notice: Apache 2.0',
      expectedActionType: 'requestFilesContent',
      expectedMessageContent: expect.stringContaining('/project/src/data-file.ts'),
      sourceCode: {
        ...MOCK_SOURCE_CODE_SUMMARIES_LARGE,
        '/project/src/data-file.ts': {
          fileId: generateFileId('/project/src/data-file.ts'),
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
      sourceCode: {
        ...MOCK_SOURCE_CODE_SUMMARIES_LARGE,
        '/project/src/todo-app/existing-file.ts': {
          fileId: generateFileId('/project/src/todo-app/existing-file.ts'),
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
      sourceCode: {
        ...MOCK_SOURCE_CODE_SUMMARIES_LARGE,
        '/project/src/todo-app/other-file.ts': {
          fileId: generateFileId('/project/src/todo-app/other-file.ts'),
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
    {
      name: 'reasoning inference',
      userMessage: 'Im thinking about proper architecture for genai app, lets perform a reasoning inference about this',
      expectedActionType: 'reasoningInference',
      promptPrefix: [],
    },
    {
      name: 'forced reasoning inference',
      userMessage: 'lets run reasoning inference',
      expectedActionType: 'reasoningInference',
      promptPrefix: [],
    },
    {
      name: 'complex feature implementation',
      userMessage: `Let's implement a new authentication feature for the project. We need to:
1. Add user authentication with email/password
2. Implement secure password hashing
3. Create login/logout endpoints
4. Add session management
5. Integrate with the existing user interface
6. Add proper error handling
7. Include security best practices
8. Write tests for all components`,
      expectedActionType: 'conversationGraph' as ActionType,
      expectedMessageContent: expect.stringContaining('authentication feature'),
      sourceCode: MOCK_SOURCE_CODE_SUMMARIES_LARGE,
      promptPrefix: [],
    },
    {
      name: 'explore external directories request',
      userMessage: 'Can you list the files in /var/log?',
      expectedActionType: 'exploreExternalDirectories' as ActionType,
      expectedMessageContent: expect.stringContaining('/var/log'),
      sourceCode: {},
      promptPrefix: [],
    },
    {
      name: 'read external files request',
      userMessage: 'Can you read the contents of /var/log/syslog?',
      expectedActionType: 'readExternalFiles' as ActionType,
      expectedMessageContent: expect.stringContaining('/var/log/syslog'),
      sourceCode: {},
      promptPrefix: [],
    },
    {
      name: 'ambiguous external file/directory request',
      userMessage: 'Can you check the logs in /var/log?',
      expectedActionType: 'exploreExternalDirectories' as ActionType,
      expectedMessageContent: expect.stringMatching('/var/log'),
      sourceCode: {},
      promptPrefix: [],
    },
  ])('$name', async ({ userMessage, expectedActionType, expectedMessageContent, sourceCode, promptPrefix }) => {
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
            content: JSON.stringify(sourceCode),
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
    const result = await generateContent(
      prompt,
      {
        functionDefs: getFunctionDefs(),
        requiredFunctionName: 'askQuestion',
        temperature,
        modelType,
        expectedResponseType: {
          text: false,
          functionCall: true,
          media: false,
        },
      },
      {},
    );
    const [askQuestionCall] = (
      await validateAndRecoverSingleResult(
        [
          prompt,
          {
            functionDefs: getFunctionDefs(),
            requiredFunctionName: 'askQuestion',
            temperature,
            modelType,
            expectedResponseType: {
              text: false,
              functionCall: true,
              media: false,
            },
          },
          {},
        ],
        result,
        generateContent,
      )
    )
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall);

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
