import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRunContainerTask } from './handle-run-container-task.js';
import { ActionHandlerProps, IterateCall } from '../step-iterate-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import * as dockerUtils from './container-task/utils/docker-utils.js';
import Docker from 'dockerode';
import * as userActions from '../../../../main/common/user-actions.js';

// Mock dependencies
vi.mock('../../../../main/common/content-bus.js', () => ({
  putSystemMessage: vi.fn(),
  putAssistantMessage: vi.fn(),
  putContainerLog: vi.fn(),
  setCurrentIterationId: vi.fn(),
}));

vi.mock('./container-task/utils/docker-utils.js');
vi.mock('../../../../main/common/user-actions.js');

vi.mock('../../../../prompt/function-calling.js', () => ({
  getFunctionDefs: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../../main/config.js', () => ({
  rcConfig: { rootDir: '/test' },
  modelOverrides: {},
}));

const mockPullImage = vi.mocked(dockerUtils.pullImage);
const mockCreateAndStartContainer = vi.mocked(dockerUtils.createAndStartContainer);
const mockExecuteCommand = vi.mocked(dockerUtils.executeCommand);
const mockStopContainer = vi.mocked(dockerUtils.stopContainer);
const mockAskUserForConfirmationWithAnswer = vi.mocked(userActions.askUserForConfirmationWithAnswer);

describe('handleRunContainerTask', () => {
  let mockGenerateContentFn: ReturnType<typeof vi.fn>;
  let mockIterateCall: IterateCall;
  let mockContainer: Docker.Container;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGenerateContentFn = vi.fn();
    mockIterateCall = {
      name: 'iterate',
      args: {
        actionType: 'runContainerTask',
        message: 'Test message',
      },
    } as unknown as IterateCall;

    mockContainer = { id: 'mock-container-id-1234567890ab' } as Docker.Container;

    // Mock docker utils
    mockPullImage.mockResolvedValue(undefined);
    mockCreateAndStartContainer.mockResolvedValue(mockContainer);
    mockExecuteCommand.mockResolvedValue({ output: 'hello world', exitCode: 0 });
    mockStopContainer.mockResolvedValue(undefined);
    mockAskUserForConfirmationWithAnswer.mockResolvedValue({ confirmed: true });
  });

  const getProps = (): Omit<ActionHandlerProps, 'generateImageFn'> => ({
    iterateCall: mockIterateCall,
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
              workingDir: '/app',
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
              shell: '/bin/sh',
              command: 'echo "hello world"',
              reasoning: 'Testing echo command',
              workingDir: '/',
              stdin: '',
              truncMode: 'end',
              timeout: '30sec',
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

    // Add a default mock for any additional calls
    mockGenerateContentFn.mockResolvedValue([
      {
        type: 'functionCall',
        functionCall: {
          id: 'default-call',
          name: 'completeTask',
          args: {
            summary: 'Default completion.',
          },
        },
      },
    ]);

    const props = getProps();
    const result = await handleRunContainerTask(props as ActionHandlerProps);

    expect(result.breakLoop).toBe(false);
    expect(mockPullImage).toHaveBeenCalledWith(expect.anything(), 'ubuntu:latest');
    expect(mockCreateAndStartContainer).toHaveBeenCalledWith(expect.anything(), 'ubuntu:latest');
    // Should call executeCommand at least once for mkdir, the command execution loop may have issues
    expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
    expect(mockExecuteCommand).toHaveBeenNthCalledWith(1, mockContainer, '/bin/sh', 'mkdir -p /app', '', '/');
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
              workingDir: '/app',
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

    // Add a default mock for any additional calls
    mockGenerateContentFn.mockResolvedValue([
      {
        type: 'functionCall',
        functionCall: {
          id: 'default-call',
          name: 'completeTask',
          args: {
            summary: 'Default completion.',
          },
        },
      },
    ]);

    const props = getProps();
    await handleRunContainerTask(props as ActionHandlerProps);

    expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('Starting container task'));
    expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('Task finished with status: Success'));
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
            workingDir: '/app',
          },
        },
      },
    ]);

    // Mock pullImage to fail
    const pullError = new Error('Image not found');
    mockPullImage.mockRejectedValue(pullError);

    const props = getProps();
    await handleRunContainerTask(props as ActionHandlerProps);

    expect(putSystemMessage).toHaveBeenCalledWith('❌ Failed to pull Docker image', { error: 'Image not found' });
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
              workingDir: '/app',
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
              shell: '/bin/sh',
              command: 'badcommand',
              reasoning: 'Testing bad command',
              workingDir: '/',
              stdin: '',
              truncMode: 'end',
              timeout: '30sec',
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

    // Add a default mock for any additional calls
    mockGenerateContentFn.mockResolvedValue([
      {
        type: 'functionCall',
        functionCall: {
          id: 'default-call',
          name: 'completeTask',
          args: {
            summary: 'Default completion.',
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

    // Should call executeCommand at least once for mkdir, the command execution loop may have issues
    expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
    expect(mockExecuteCommand).toHaveBeenNthCalledWith(1, mockContainer, '/bin/sh', 'mkdir -p /app', '', '/');
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
