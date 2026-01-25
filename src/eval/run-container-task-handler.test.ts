import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentOpenAI } from '../ai-service/openai.js';
import { generateContent as generateContentGitHub } from '../ai-service/github-models.js';
import { PromptItem } from '../ai-service/common-types.js';
import { retryGenerateContent } from './test-utils/generate-content-retry.js';
import { handleRunContainerTask } from '../prompt/steps/step-iterate/handlers/handle-run-container-task.js';
import { ActionHandlerProps } from '../prompt/steps/step-iterate/step-iterate-types.js';
import { AiServiceType } from '../ai-service/service-configurations-types.js';
import { validateLLMContent } from './test-utils/llm-content-validate.js';

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
  { model: 'Gemini Flash', aiService: 'ai-studio' as AiServiceType, generateContent: generateContentAiStudio },
  { model: 'Claude Haiku', aiService: 'anthropic' as AiServiceType, generateContent: generateContentAnthropic },
  { model: 'GPT-4o Mini', aiService: 'openai' as AiServiceType, generateContent: generateContentOpenAI },
  { model: 'GH', aiService: 'github-models' as AiServiceType, generateContent: generateContentGitHub },
])('Run Container Task Handler E2E: $model', ({ model, aiService, generateContent }) => {
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
      } else if (model.includes('GH')) {
        return !!process.env.GITHUB_TOKEN;
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
      expectation: 'The response should include system information such as OS version, CPU info, and memory usage.',
    },
    {
      name: 'file operations task',
      userMessage: 'Create and manipulate some files in an Alpine container',
      expectation: 'The response should include the results of file operations such as creation, writing, and reading.',
    },
    {
      name: 'Python script execution',
      userMessage: 'Execute a simple Python script to calculate fibonacci numbers, and return the result',
      expectation: 'The response should include the results of the Python script execution.',
    },
    {
      name: 'complex task',
      userMessage:
        'please checkout the project from https://github.com/gtanczyk/genaicode (node.js project) and build it. If you encounter any compilation errors => FIX THEM, please report success or error',
      expectation: 'The response should include the results of the build process.',
    },
  ])('$name', async ({ userMessage, expectation }) => {
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

    const prompt: PromptItem[] = [{ type: 'user', text: userMessage }];

    // Step 2: Execute the run container task handler with real LLM
    const handlerProps: ActionHandlerProps = {
      iterateCall: {
        name: 'iterate',
        args: {
          actionType: 'runContainerTask',
          message: 'I will use a container to fulfill your request',
        },
      },
      prompt,
      generateContentFn: generateContent,
      generateImageFn: async () => 'empty',
      waitIfPaused: async () => {}, // No-op for testing
      options: {
        aiService: aiService,
        askQuestion: true,
      },
    };

    // Execute the actual handler
    const result = await handleRunContainerTask(handlerProps);

    // Verify the handler completed successfully
    expect(result).toBeDefined();
    expect(result.breakLoop).toBeDefined();
    expect(result.items).toBeDefined();

    // Check that we got some conversation items back
    expect(result.items.length).toBe(0);

    // Find the final task result
    const lastItem = prompt[prompt.length - 1];

    console.log('Final conversation items count:', prompt.length);
    console.log('Last conversation item:', JSON.stringify(lastItem, null, 2));

    expect(lastItem.functionResponses?.[0].name).toBe('runContainerTask');

    const content = lastItem.functionResponses?.[0].content;
    expect(content).toBeDefined();

    expect(
      await validateLLMContent(generateContent, content!, {
        description: expectation,
      }),
    ).toBe(true);
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

    const handlerProps: ActionHandlerProps = {
      iterateCall: {
        name: 'iterate',
        args: {
          actionType: 'runContainerTask',
          message: 'Run a container task to check system information',
        },
      },
      prompt: [],
      generateContentFn: generateContent,
      generateImageFn: async () => 'empty',
      waitIfPaused: async () => {}, // No-op for testing
      options: {
        aiService: aiService,
        askQuestion: true,
      },
    };

    // This should handle Docker unavailability gracefully
    const result = await handleRunContainerTask(handlerProps);

    expect(result).toBeDefined();
    expect(result.breakLoop).toBeDefined();
    expect(result.items).toBeDefined();

    // Should have error handling for Docker unavailability
    const hasErrorMessage = result.items.some(
      (item) =>
        item.user?.text?.toLowerCase().includes('docker') ||
        item.user?.functionResponses?.some((resp) => resp.content?.toLowerCase().includes('docker')),
    );

    expect(hasErrorMessage).toBe(true);
  });
});
