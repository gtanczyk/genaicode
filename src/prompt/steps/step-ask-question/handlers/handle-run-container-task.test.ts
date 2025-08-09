import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRunContainerTask } from './handle-run-container-task.js';
import { ActionHandlerProps, AskQuestionCall } from '../step-ask-question-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import * as dockerUtils from '../../../../utils/docker-utils.js';
import Docker from 'dockerode';

// Mock dependencies
vi.mock('../../../../main/common/content-bus.js', () => ({
  putSystemMessage: vi.fn(),
}));

vi.mock('../../../../utils/docker-utils.js');

vi.mock('../../../../prompt/function-calling.js', () => ({
  getFunctionDefs: vi.fn().mockReturnValue([]),
}));

const mockPullImage = vi.mocked(dockerUtils.pullImage);
const mockCreateAndStartContainer = vi.mocked(dockerUtils.createAndStartContainer);
const mockExecuteCommand = vi.mocked(dockerUtils.executeCommand);
const mockStopContainer = vi.mocked(dockerUtils.stopContainer);

describe('handleRunContainerTask', () => {
  let mockGenerateContentFn: ReturnType<typeof vi.fn>;
  let mockAskQuestionCall: AskQuestionCall;
  let mockContainer: Docker.Container;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGenerateContentFn = vi.fn();
    mockAskQuestionCall = {
      name: 'askQuestion',
      args: {
        actionType: 'runContainerTask',
        message: 'Test message',
      },
    } as unknown as AskQuestionCall;

    mockContainer = { id: 'mock-container-id-1234567890ab' } as Docker.Container;

    // Mock docker utils
    mockPullImage.mockResolvedValue(undefined);
    mockCreateAndStartContainer.mockResolvedValue(mockContainer);
    mockExecuteCommand.mockResolvedValue({ output: 'hello world', exitCode: 0 });
    mockStopContainer.mockResolvedValue(undefined);
  });

  const getProps = (): Omit<ActionHandlerProps, 'generateImageFn' | 'waitIfPaused'> => ({
    askQuestionCall: mockAskQuestionCall,
    prompt: [],
    options: {} as unknown as ActionHandlerProps['options'],
    generateContentFn: mockGenerateContentFn,
  });

  it('should successfully run a simple task', async () => {
    // Mock generateContentFn to return runContainerTask function call
    mockGenerateContentFn
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-1',
            name: 'runContainerTask',
            args: {
              image: 'ubuntu:latest',
              taskDescription: 'Run a simple echo test.',
            },
          },
        },
      ])
      // Mock command execution directly (simplified flow)
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-2',
            name: 'runCommand',
            args: {
              command: 'echo "hello world"',
              reasoning: 'Testing echo command',
            },
          },
        },
      ])
      // Mock completion
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-3',
            name: 'completeTask',
            args: {
              summary: 'The task completed successfully.',
            },
          },
        },
      ]);

    const props = getProps();
    const result = await handleRunContainerTask(props as ActionHandlerProps);

    expect(result.breakLoop).toBe(true);
    expect(mockPullImage).toHaveBeenCalledWith(expect.anything(), 'ubuntu:latest');
    expect(mockCreateAndStartContainer).toHaveBeenCalledWith(expect.anything(), 'ubuntu:latest');
    expect(mockExecuteCommand).toHaveBeenCalledWith(mockContainer, 'echo "hello world"');
    expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('Task finished with status: Success'));
    expect(mockStopContainer).toHaveBeenCalledWith(mockContainer);
  });

  it('should handle command execution failure', async () => {
    // Mock generateContentFn to return runContainerTask function call
    mockGenerateContentFn
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-1',
            name: 'runContainerTask',
            args: {
              image: 'ubuntu:latest',
              taskDescription: 'Run a test task.',
            },
          },
        },
      ])
      // Mock invalid function call (no valid response)
      .mockResolvedValueOnce([]);

    const props = getProps();
    const result = await handleRunContainerTask(props as ActionHandlerProps);

    expect(result.breakLoop).toBe(true);
    expect(putSystemMessage).toHaveBeenCalledWith('❌ Internal LLM failed to produce a valid function call.');
    expect(mockStopContainer).toHaveBeenCalledWith(mockContainer);
  });


  it('should handle image pull failure', async () => {
    // Mock generateContentFn to return runContainerTask function call
    mockGenerateContentFn.mockResolvedValueOnce([
      {
        type: 'functionCall',
        functionCall: {
          id: 'test-call-1',
          name: 'runContainerTask',
          args: {
            image: 'ubuntu:latest',
            taskDescription: 'Run a test task.',
          },
        },
      },
    ]);

    // Mock pullImage to fail
    const pullError = new Error('Image not found');
    mockPullImage.mockRejectedValue(pullError);

    const props = getProps();
    await handleRunContainerTask(props as ActionHandlerProps);

    expect(putSystemMessage).toHaveBeenCalledWith('❌ Failed to pull Docker image: Image not found');
    expect(mockCreateAndStartContainer).not.toHaveBeenCalled();
  });

  it('should handle optional planning tools', async () => {
    // Mock the function call extraction
    vi.mocked(getFunctionDefs).mockReturnValue([
      {
        type: 'function',
        function: {
          name: 'runContainerTask',
          description: 'Execute a task in a Docker container',
        },
      },
    ]);

    mockGenerateContentFn
      // Initial request
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-1',
            name: 'runContainerTask',
            args: {
              image: 'ubuntu:latest',
              taskDescription: 'Analyze and execute task.',
            },
          },
        },
      ])
      // Mock optional analyzeTask tool usage
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-2',
            name: 'analyzeTask',
            args: {
              analysis: 'This task requires careful planning',
              approach: 'Use systematic approach with verification',
            },
          },
        },
      ])
      // Mock optional planSteps tool usage
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-3',
            name: 'planSteps',
            args: {
              plan: 'Step 1: Check environment, Step 2: Execute command, Step 3: Verify result',
            },
          },
        },
      ])
      // Mock command execution
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-4',
            name: 'runCommand',
            args: {
              command: 'echo "planned execution"',
              reasoning: 'Execute according to plan',
            },
          },
        },
      ])
      // Mock completion
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-5',
            name: 'completeTask',
            args: {
              summary: 'Task completed using planning tools.',
            },
          },
        },
      ]);

    const props = getProps();
    const result = await handleRunContainerTask(props as ActionHandlerProps);

    expect(result.breakLoop).toBe(true);
    expect(mockPullImage).toHaveBeenCalledWith(expect.anything(), 'ubuntu:latest');
    expect(mockCreateAndStartContainer).toHaveBeenCalledWith(expect.anything(), 'ubuntu:latest');
    expect(mockExecuteCommand).toHaveBeenCalledWith(mockContainer, 'echo "planned execution"');
    expect(putSystemMessage).toHaveBeenCalledWith('📊 Task Analysis: This task requires careful planning');
    expect(putSystemMessage).toHaveBeenCalledWith('🎯 Approach: Use systematic approach with verification');
    expect(putSystemMessage).toHaveBeenCalledWith('📋 Execution Plan: Step 1: Check environment, Step 2: Execute command, Step 3: Verify result');
  });

  it('should handle invalid function call generation', async () => {
    // Mock generateContentFn to return invalid response
    mockGenerateContentFn.mockResolvedValueOnce([]);

    const props = getProps();
    const result = await handleRunContainerTask(props as ActionHandlerProps);

    expect(result.breakLoop).toBe(false);
    expect(putSystemMessage).toHaveBeenCalledWith('❌ Failed to get valid runContainerTask request');
    expect(mockPullImage).not.toHaveBeenCalled();
  });
});
