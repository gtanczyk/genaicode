import { describe, it, expect, vi } from 'vitest';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentOpenAI } from '../ai-service/openai.js';
import { generateContent as generateContentLocalLllm } from '../ai-service/local-llm.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import { PromptItem, ModelType } from '../ai-service/common-types.js';
import { validateAndRecoverSingleResult } from '../prompt/steps/step-validate-recover.js';
import { GIT_CONTEXT_INSTRUCTION_PROMPT } from '../prompt/steps/step-iterate/handlers/handle-request-git-context.js';
import { RequestGitContextArgs } from '../prompt/steps/step-iterate/step-iterate-types.js';
import { retryGenerateContent } from './test-utils/generate-content-retry.js';
import { getSystemPrompt } from '../prompt/systemprompt.js';

vi.setConfig({
  testTimeout: 3 * 60000,
});

describe.each([
  { model: 'Gemini Flash', generateContent: generateContentAiStudio, modelType: ModelType.CHEAP },
  { model: 'Claude Haikku', generateContent: generateContentAnthropic, modelType: ModelType.CHEAP },
  { model: 'GPT-4o Mini', generateContent: generateContentOpenAI, modelType: ModelType.CHEAP },
  { model: 'Local LLM', generateContent: generateContentLocalLllm, modelType: ModelType.CHEAP },
])('requestGitContext Prompt Inference: $model', ({ generateContent, modelType }) => {
  generateContent = retryGenerateContent(generateContent);

  it.each([
    {
      name: 'request recent commits',
      userMessage: 'Show me the recent commits.',
      assistantResponse: 'I will show you the recent commits.',
      expectedArgs: {
        requestType: 'commits',
        count: 10,
        filePath: undefined,
        commitHash: undefined,
      } as RequestGitContextArgs,
    },
    {
      name: 'request commits with count',
      userMessage: 'Show me the last 10 commits.',
      assistantResponse: 'I will show you the last 10 commits.',
      expectedArgs: {
        requestType: 'commits',
        count: 10,
        filePath: undefined,
        commitHash: undefined,
      } as RequestGitContextArgs,
    },
    {
      name: 'request file changes',
      userMessage: 'What are the changes for src/main/config.ts?',
      assistantResponse: 'I will show you the changes for src/main/config.ts.',
      expectedArgs: {
        requestType: 'fileChanges',
        count: 10,
        filePath: '/project/src/main/config.ts',
      } as RequestGitContextArgs,
    },
    {
      name: 'request changes with count',
      userMessage: 'Show me the last 5 changes to package.json.',
      assistantResponse: 'I will show you the last 5 changes to package.json.',
      expectedArgs: {
        requestType: 'fileChanges',
        filePath: '/project/src/package.json',
        count: 5,
      } as RequestGitContextArgs,
    },
    {
      name: 'request blame',
      userMessage: 'Who wrote the code in src/files/file-utils.ts?',
      assistantResponse: 'I will show you the blame for src/files/file-utils.ts.',
      expectedArgs: {
        requestType: 'blame',
        filePath: '/project/src/files/file-utils.ts',
      } as RequestGitContextArgs,
    },
    {
      name: 'request blame with commit hash',
      userMessage: 'Who changed line 5 in src/main/config.ts around commit a1b2c3d?',
      assistantResponse: 'I will show you the blame for src/main/config.ts around commit a1b2c3d.',
      expectedArgs: {
        requestType: 'blame',
        filePath: '/project/src/main/config.ts',
        commitHash: 'a1b2c3d',
        count: undefined,
      } as RequestGitContextArgs,
    },
    {
      name: 'request file changes with commit hash',
      userMessage: 'Show last 10 changes to package.json since commit a1b2c3d',
      assistantResponse: 'I will show you the changes to package.json since commit a1b2c3d.',
      expectedArgs: {
        requestType: 'fileChanges',
        filePath: '/project/src/package.json',
        commitHash: 'a1b2c3d', // LLM should extract this, even if handler doesn't use it for filtering
        count: 10, // Default count
      } as RequestGitContextArgs,
    },
    {
      name: 'request file changes with relative path',
      userMessage: 'what changed in ../files/file-utils.ts?', // Assuming rootDir is /project/src
      assistantResponse: 'I will show you the changes in ../files/file-utils.ts.',
      expectedArgs: {
        requestType: 'fileChanges',
        filePath: '/project/src/files/file-utils.ts', // LLM should resolve/normalize the path relative to rootDir
        count: 10,
        commitHash: undefined,
      } as RequestGitContextArgs,
    },
    {
      name: 'request file diff',
      userMessage: 'Show me the diff for src/main.ts in commit abc1234.',
      assistantResponse: 'I will show you the diff for src/main.ts in commit abc1234.',
      expectedArgs: {
        requestType: 'fileDiff',
        filePath: '/project/src/main.ts',
        commitHash: 'abc1234',
        count: undefined, // Count is not applicable here
      } as RequestGitContextArgs,
    },
    {
      name: 'request file diff with different phrasing',
      userMessage: 'What were the changes made to path/to/my/file.js in commit 987fed?',
      assistantResponse: 'Okay, I will retrieve the diff for path/to/my/file.js in commit 987fed.',
      expectedArgs: {
        requestType: 'fileDiff',
        filePath: '/project/src/path/to/my/file.js',
        commitHash: '987fed',
        count: undefined,
      } as RequestGitContextArgs,
    },
    // Add more test cases for different user requests and combinations of arguments
  ])('$name', async ({ userMessage, assistantResponse, expectedArgs }) => {
    const prompt: PromptItem[] = [
      {
        type: 'systemPrompt',
        systemPrompt: getSystemPrompt(
          {
            rootDir: '/project/src',
          },
          {
            askQuestion: true,
            ui: true,
          },
        ),
      },
      { type: 'user', text: userMessage },
      { type: 'assistant', text: assistantResponse },
      { type: 'user', text: GIT_CONTEXT_INSTRUCTION_PROMPT },
    ];

    const result = await generateContent(
      prompt,
      {
        functionDefs: getFunctionDefs(),
        requiredFunctionName: 'requestGitContext',
        temperature: 0.7,
        modelType,
        expectedResponseType: { text: false, functionCall: true, media: false },
      },
      {}, // options
    );

    const [gitContextCall] = (
      await validateAndRecoverSingleResult(
        [
          prompt,
          {
            functionDefs: getFunctionDefs(),
            requiredFunctionName: 'requestGitContext',
            temperature: 0.7,
            modelType,
            expectedResponseType: { text: false, functionCall: true, media: false },
          },
          {}, // options
        ],
        result,
        generateContent,
        '/project/src', // rootDir
      )
    )
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall);

    console.log(JSON.stringify(gitContextCall, null, 2));

    expect(gitContextCall).toBeDefined();
    expect(gitContextCall.name).toBe('requestGitContext');
    expect(gitContextCall.args).toBeDefined();
    expect(gitContextCall.args).toEqual(expectedArgs);
  });
});
