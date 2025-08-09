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

  it('should successfully run a simple task with Think-Plan-Execute cycle', async () => {
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
      // Mock task analysis
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-2',
            name: 'analyzeTask',
            args: {
              analysis: 'This is a simple task to run an echo command',
              complexity: 'simple',
              approach: 'Use basic shell commands',
            },
          },
        },
      ])
      // Mock plan creation
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-3',
            name: 'planSteps',
            args: {
              steps: [
                {
                  phase: 'orientation',
                  commands: ['pwd', 'ls'],
                  rationale: 'Check environment',
                  riskLevel: 'low',
                },
                {
                  phase: 'execution',
                  commands: ['echo "hello world"'],
                  rationale: 'Execute main task',
                  riskLevel: 'low',
                },
              ],
            },
          },
        },
      ])
      // Mock command execution - first runCommand
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-4',
            name: 'runCommand',
            args: {
              command: 'echo "hello world"',
              reasoning: 'Testing echo command',
              phase: 'execution',
              expectedOutcome: 'Print hello world to stdout',
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

  it('should handle task analysis failure', async () => {
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
      // Mock analysis failure (no function call)
      .mockResolvedValueOnce([]);

    const props = getProps();
    const result = await handleRunContainerTask(props as ActionHandlerProps);

    expect(result.breakLoop).toBe(true);
    expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('Failed to analyze task requirements'));
    expect(mockStopContainer).toHaveBeenCalledWith(mockContainer);
  });

  it('should handle command execution with fallback', async () => {
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
      // Mock task analysis
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-2',
            name: 'analyzeTask',
            args: {
              analysis: 'Test task with fallback',
              complexity: 'medium',
              approach: 'Use commands with fallback',
            },
          },
        },
      ])
      // Mock plan creation
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-3',
            name: 'planSteps',
            args: {
              steps: [
                {
                  phase: 'execution',
                  commands: ['primarycommand'],
                  rationale: 'Try primary approach',
                  riskLevel: 'medium',
                },
              ],
            },
          },
        },
      ])
      // Mock command execution with fallback
      .mockResolvedValueOnce([
        {
          type: 'functionCall',
          functionCall: {
            id: 'test-call-4',
            name: 'runCommand',
            args: {
              command: 'primarycommand',
              reasoning: 'Try primary command',
              phase: 'execution',
              expectedOutcome: 'Command should work',
              fallbackCommand: 'fallbackcommand',
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
              summary: 'Task completed with fallback.',
            },
          },
        },
      ]);

    // Mock primary command failure and fallback success
    mockExecuteCommand
      .mockResolvedValueOnce({
        output: 'primarycommand: not found',
        exitCode: 1,
      })
      .mockResolvedValueOnce({
        output: 'fallback succeeded',
        exitCode: 0,
      });

    const props = getProps();
    await handleRunContainerTask(props as ActionHandlerProps);

    expect(mockExecuteCommand).toHaveBeenCalledWith(mockContainer, 'primarycommand');
    expect(mockExecuteCommand).toHaveBeenCalledWith(mockContainer, 'fallbackcommand');
    expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('trying fallback'));
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
