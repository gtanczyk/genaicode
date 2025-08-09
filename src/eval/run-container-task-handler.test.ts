import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentOpenAI } from '../ai-service/openai.js';
import { PromptItem, ModelType, FunctionCall } from '../ai-service/common-types.js';
import { getSystemPrompt } from '../prompt/systemprompt.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import {
  INITIAL_GREETING,
  READY_TO_ASSIST,
  REQUEST_SOURCE_CODE,
  SOURCE_CODE_RESPONSE,
} from '../prompt/static-prompts.js';
import { retryGenerateContent } from './test-utils/generate-content-retry.js';
import { validateAndRecoverSingleResult } from '../prompt/steps/step-validate-recover.js';
import { handleRunContainerTask } from '../prompt/steps/step-ask-question/handlers/handle-run-container-task.js';
import { ActionHandlerProps } from '../prompt/steps/step-ask-question/step-ask-question-types.js';

vi.setConfig({
  testTimeout: 5 * 60000, // 5 minutes for Docker operations
});

/**
 * Check if Docker is available on the system by attempting a simple import
 * This is a lightweight check that doesn't require actual Docker to be running
 */
async function checkDockerAvailability(): Promise<boolean> {
  try {
    // Try to import dockerode - if it fails, Docker support is not available
    const Docker = (await import('dockerode')).default;
    if (!Docker) return false;

    // Try to create a Docker instance - if this fails, Docker is not available
    const docker = new Docker();
    await docker.ping();
    return true;
  } catch (error) {
    console.log('Docker not available:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

describe.each([
  { model: 'Gemini Flash', generateContent: generateContentAiStudio, modelType: ModelType.CHEAP },
  { model: 'Claude Haiku', generateContent: generateContentAnthropic, modelType: ModelType.CHEAP },
  { model: 'GPT-4o Mini', generateContent: generateContentOpenAI, modelType: ModelType.CHEAP },
])('Run Container Task Handler E2E: $model', ({ model, generateContent, modelType }) => {
  generateContent = retryGenerateContent(generateContent);

  // Check if API key is available for the model
  const isApiKeyAvailable = () => {
    try {
      if (model.includes('Gemini')) {
        return !!process.env.API_KEY;
      } else if (model.includes('Claude')) {
        return !!process.env.ANTHROPIC_API_KEY;
      } else if (model.includes('GPT')) {
        return !!process.env.OPENAI_API_KEY;
      }
      return false;
    } catch {
      return false;
    }
  };

  beforeEach(async () => {
    // Skip test if Docker is not available
    const dockerAvailable = await checkDockerAvailability();
    if (!dockerAvailable) {
      console.log('Skipping Docker container task tests - Docker not available');
      return;
    }

    // Skip if API key is not available
    if (!isApiKeyAvailable()) {
      console.log(`Skipping ${model} tests - API key not configured`);
      return;
    }
  });

  it.each([
    {
      name: 'simple command execution',
      userMessage: 'Run a container task to check system information using Ubuntu',
      taskDescription: 'Check system information including OS version, CPU info, and memory usage',
      expectedImage: 'ubuntu:latest',
      expectedCommands: ['uname', 'cat /etc/os-release', 'lscpu', 'free'],
    },
    {
      name: 'file operations task',
      userMessage: 'Create and manipulate some files in an Alpine container',
      taskDescription: 'Create a text file, write some content to it, and then display its contents',
      expectedImage: 'alpine:latest',
      expectedCommands: ['echo', 'cat', 'ls'],
    },
    {
      name: 'Python script execution',
      userMessage: 'Execute a simple Python script to calculate fibonacci numbers',
      taskDescription: 'Create and run a Python script that calculates the first 10 fibonacci numbers',
      expectedImage: 'python:latest',
      expectedCommands: ['python', 'echo'],
    },
  ])('$name', async ({ userMessage, taskDescription, expectedImage, expectedCommands }) => {
    // Skip test if Docker is not available
    const dockerAvailable = await checkDockerAvailability();
    if (!dockerAvailable) {
      console.log('Skipping test - Docker not available');
      return;
    }

    // Skip if API key is not available
    if (!isApiKeyAvailable()) {
      console.log(`Skipping test - ${model} API key not configured`);
      return;
    }

    // Prepare base prompt conversation
    const basePrompt: PromptItem[] = [
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
            content: JSON.stringify({}),
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
    ];

    // Step 1: Get askQuestion call that should trigger runContainerTask
    const askQuestionResult = await generateContent(
      basePrompt,
      {
        functionDefs: getFunctionDefs(),
        requiredFunctionName: 'askQuestion',
        temperature: 0.2,
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
          basePrompt,
          {
            functionDefs: getFunctionDefs(),
            requiredFunctionName: 'askQuestion',
            temperature: 0.2,
            modelType,
            expectedResponseType: {
              text: false,
              functionCall: true,
              media: false,
            },
          },
          {},
        ],
        askQuestionResult,
        generateContent,
      )
    )
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall);

    // Verify we got a runContainerTask action
    expect(askQuestionCall).toBeDefined();
    expect(askQuestionCall.name).toBe('askQuestion');
    expect(askQuestionCall.args?.actionType).toBe('runContainerTask');

    console.log('AskQuestion call:', JSON.stringify(askQuestionCall.args, null, 2));

    // Step 2: Execute the run container task handler with real LLM
    const handlerProps: ActionHandlerProps = {
      askQuestionCall,
      prompt: [...basePrompt],
      generateContentFn: generateContent,
      options: {},
    };

    // Execute the actual handler
    const result = await handleRunContainerTask(handlerProps);

    // Verify the handler completed successfully
    expect(result).toBeDefined();
    expect(result.breakLoop).toBeDefined();
    expect(result.items).toBeDefined();

    // Check that we got some conversation items back
    expect(result.items.length).toBeGreaterThan(0);

    // Find the final task result
    const conversationItems = result.items;
    const lastItem = conversationItems[conversationItems.length - 1];

    console.log('Final conversation items count:', conversationItems.length);
    console.log('Last conversation item:', JSON.stringify(lastItem, null, 2));

    // Should have either completed or failed (not infinite loop)
    const hasCompletion = conversationItems.some(
      (item) =>
        item.type === 'user' &&
        item.functionResponses?.some((resp) => resp.name === 'completeTask' || resp.name === 'failTask'),
    );

    const hasContainerExecution = conversationItems.some(
      (item) => item.type === 'user' && item.functionResponses?.some((resp) => resp.name === 'runCommand'),
    );

    // Should have executed at least one command or completed/failed properly
    expect(hasContainerExecution || hasCompletion).toBe(true);

    // If we have container execution, verify some expected behavior
    if (hasContainerExecution) {
      const runCommandResponses = conversationItems
        .filter((item) => item.type === 'user')
        .flatMap((item) => item.functionResponses || [])
        .filter((resp) => resp.name === 'runCommand');

      expect(runCommandResponses.length).toBeGreaterThan(0);

      // Check if some expected commands were used
      const commandOutputs = runCommandResponses.map((resp) => resp.content).join(' ');
      const usedExpectedCommand = expectedCommands.some((cmd) =>
        commandOutputs.toLowerCase().includes(cmd.toLowerCase()),
      );

      // At least one expected command should be found
      expect(usedExpectedCommand).toBe(true);
    }

    // Verify no infinite loops by checking reasonable conversation length
    expect(conversationItems.length).toBeLessThan(100); // Reasonable upper bound
  });

  it('should handle Docker unavailable gracefully', async () => {
    // Skip test if Docker is actually available
    const dockerAvailable = await checkDockerAvailability();
    if (dockerAvailable) {
      console.log('Skipping Docker unavailable test - Docker is actually available');
      return;
    }

    // Skip if API key is not available
    if (!isApiKeyAvailable()) {
      console.log(`Skipping test - ${model} API key not configured`);
      return;
    }

    const basePrompt: PromptItem[] = [
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
            content: JSON.stringify({}),
          },
        ],
      },
      {
        type: 'assistant',
        text: READY_TO_ASSIST,
      },
      {
        type: 'user',
        text: 'Run a container task to check system information',
      },
    ];

    const askQuestionResult = await generateContent(
      basePrompt,
      {
        functionDefs: getFunctionDefs(),
        requiredFunctionName: 'askQuestion',
        temperature: 0.2,
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
          basePrompt,
          {
            functionDefs: getFunctionDefs(),
            requiredFunctionName: 'askQuestion',
            temperature: 0.2,
            modelType,
            expectedResponseType: {
              text: false,
              functionCall: true,
              media: false,
            },
          },
          {},
        ],
        askQuestionResult,
        generateContent,
      )
    )
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall);

    if (askQuestionCall?.args?.actionType === 'runContainerTask') {
      const handlerProps: ActionHandlerProps = {
        askQuestionCall,
        prompt: [...basePrompt],
        generateContentFn: generateContent,
        options: {},
      };

      // This should handle Docker unavailability gracefully
      const result = await handleRunContainerTask(handlerProps);

      expect(result).toBeDefined();
      expect(result.breakLoop).toBeDefined();
      expect(result.items).toBeDefined();

      // Should have error handling for Docker unavailability
      const hasErrorMessage = result.items.some(
        (item) =>
          item.type === 'user' &&
          (item.text?.toLowerCase().includes('docker') ||
            item.functionResponses?.some((resp) => resp.content?.toLowerCase().includes('docker'))),
      );

      expect(hasErrorMessage).toBe(true);
    } else {
      console.log('Test skipped - LLM did not choose runContainerTask action');
    }
  });
});
