import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRunContainerTask } from './handle-run-container-task.js';
import { ActionHandlerProps, AskQuestionCall } from '../step-ask-question-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import * as dockerUtils from '../../../../utils/docker-utils.js';
import Docker from 'dockerode';
import * as userActions from '../../../../main/common/user-actions.js';

// Mock dependencies
vi.mock('../../../../main/common/content-bus.js', () => ({
  putSystemMessage: vi.fn(),
}));

vi.mock('../../../../utils/docker-utils.js');
vi.mock('../../../../main/common/user-actions.js');

vi.mock('../../../../prompt/function-calling.js', () => ({
  getFunctionDefs: vi.fn().mockReturnValue([]),
}));

const mockPullImage = vi.mocked(dockerUtils.pullImage);
const mockCreateAndStartContainer = vi.mocked(dockerUtils.createAndStartContainer);
const mockExecuteCommand = vi.mocked(dockerUtils.executeCommand);
const mockStopContainer = vi.mocked(dockerUtils.stopContainer);
const mockAskUserForConfirmation = vi.mocked(userActions.askUserForConfirmation);

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
    mockAskUserForConfirmation.mockResolvedValue({ confirmed: true });
  });

  const getProps = (): Omit<ActionHandlerProps, 'generateImageFn'> => ({
    askQuestionCall: mockAskQuestionCall,
    prompt: [],
    options: {} as unknown as ActionHandlerProps['options'],
    generateContentFn: mockGenerateContentFn,
    waitIfPaused: () => Promise.resolve(),
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
              taskDescription: 'Run a test task.',
            },
          },
        },
      ])
      // Mock command execution loop - first runCommand
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-2',
            name: 'runCommand',
            args: {
              command: 'echo "hello world"',
              reasoning: 'Testing echo command',
              workingDir: '/',
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
    expect(mockExecuteCommand).toHaveBeenCalledWith(mockContainer, 'echo "hello world"', '/');
    expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('Task finished with status: Success'));
    expect(mockStopContainer).toHaveBeenCalledWith(mockContainer);
  });

  it('should handle task failure from internal LLM', async () => {
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
      // Mock failure
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-2',
            name: 'failTask',
            args: {
              reason: 'The task failed for testing.',
            },
          },
        },
      ]);

    const props = getProps();
    await handleRunContainerTask(props as ActionHandlerProps);

    expect(putSystemMessage).toHaveBeenCalledWith('❌ Task marked as failed by internal operator.');
    expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('Task finished with status: Failed'));
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

  it('should handle command execution with failure exit code', async () => {
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
      // Mock command execution with bad command
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-2',
            name: 'runCommand',
            args: {
              command: 'badcommand',
              reasoning: 'Testing bad command',
              workingDir: '/',
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
              summary: 'The task completed with a failed command.',
            },
          },
        },
      ]);

    // Mock executeCommand to return failure
    mockExecuteCommand.mockResolvedValue({
      output: 'sh: badcommand: not found',
      exitCode: 1,
    });

    const props = getProps();
    await handleRunContainerTask(props as ActionHandlerProps);

    expect(mockExecuteCommand).toHaveBeenCalledWith(mockContainer, 'badcommand', '/');
    expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('Task finished with status: Success'));
    expect(mockStopContainer).toHaveBeenCalledWith(mockContainer);
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
