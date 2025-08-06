import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRunContainerTask } from '../prompt/steps/step-ask-question/handlers/handle-run-container-task.js';
import { ActionHandlerProps, AskQuestionCall } from '../prompt/steps/step-ask-question/step-ask-question-types.js';
import { GenerateContentFunction } from '../ai-service/common-types.js';
import { putSystemMessage } from '../main/common/content-bus.js';
import Docker from 'dockerode';
import { Stream } from 'node:stream';

// Mock dependencies
vi.mock('../main/common/content-bus.js', () => ({
  putSystemMessage: vi.fn(),
}));

vi.mock('dockerode');

describe('handleRunContainerTask', () => {
  let mockGenerateContentFn: vi.Mocked<GenerateContentFunction>;
  let mockAskQuestionCall: AskQuestionCall;
  let mockDocker: vi.Mocked<Docker>;
  let mockContainer: vi.Mocked<Docker.Container>;
  let mockExec: vi.Mocked<Docker.Exec>;
  let mockStream: Stream;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGenerateContentFn = vi.fn();
    mockAskQuestionCall = {
      name: 'askQuestion',
      args: {
        actionType: 'runContainerTask',
        message: '',
        image: 'test-image:latest',
        taskDescription: 'Run a test task.',
      },
    } as unknown as AskQuestionCall;

    mockStream = new Stream.PassThrough();

    mockExec = {
      start: vi.fn().mockResolvedValue(mockStream),
      inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
    } as unknown as vi.Mocked<Docker.Exec>;

    mockContainer = {
      id: 'mock-container-id-1234567890ab',
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      exec: vi.fn().mockResolvedValue(mockExec),
    } as unknown as vi.Mocked<Docker.Container>;

    mockDocker = {
      pull: vi.fn((_image, callback) => {
        const stream = new Stream.PassThrough();
        if (callback) {
          callback(null, stream);
        }
        stream.end();
        return Promise.resolve(stream);
      }),
      createContainer: vi.fn().mockResolvedValue(mockContainer),
      modem: {
        followProgress: vi.fn((_stream, cb) => cb(null, [])),
      },
    } as unknown as vi.Mocked<Docker>;

    (Docker as vi.Mock).mockReturnValue(mockDocker);
  });

  const getProps = (): Omit<ActionHandlerProps, 'generateImageFn' | 'waitIfPaused'> => ({
    askQuestionCall: mockAskQuestionCall,
    prompt: [],
    options: {} as any,
    generateContentFn: mockGenerateContentFn,
  });

  it('should successfully run a simple task', async () => {
    mockGenerateContentFn
      .mockResolvedValueOnce([{ type: 'text', text: 'echo "hello world"' }])
      .mockResolvedValueOnce([{ type: 'text', text: 'TASK_COMPLETE' }])
      .mockResolvedValueOnce([{ type: 'text', text: 'The task completed successfully.' }]);

    setTimeout(() => {
      mockStream.emit('data', Buffer.from('010000000000000dhello world\\n'));
      mockStream.emit('end');
    }, 100);

    const props = getProps();
    const result = await handleRunContainerTask(props as ActionHandlerProps);

    expect(result.breakLoop).toBe(true);
    expect(mockDocker.pull).toHaveBeenCalledWith('test-image:latest', expect.any(Function));
    expect(mockDocker.createContainer).toHaveBeenCalled();
    expect(mockContainer.start).toHaveBeenCalled();
    expect(mockContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({ Cmd: ['/bin/sh', '-c', 'echo "hello world"'] }),
    );
    expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('Task finished with status: Success'));
    expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('The task completed successfully.'));
    expect(mockContainer.stop).toHaveBeenCalled();
  });

  it('should handle task failure from internal LLM', async () => {
    mockGenerateContentFn
      .mockResolvedValueOnce([{ type: 'text', text: 'echo "this will run"' }])
      .mockResolvedValueOnce([{ type: 'text', text: 'TASK_FAILED' }])
      .mockResolvedValueOnce([{ type: 'text', text: 'The task failed.' }]);

    const props = getProps();
    await handleRunContainerTask(props as ActionHandlerProps);

    expect(putSystemMessage).toHaveBeenCalledWith('❌ Task marked as failed by internal operator.');
    expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('Task finished with status: Failed'));
    expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('The task failed.'));
    expect(mockContainer.stop).toHaveBeenCalled();
  });

  it('should handle image pull failure', async () => {
    const pullError = new Error('Image not found');
    (mockDocker.pull as vi.Mock).mockImplementation((_image, callback) => {
      if (callback) {
        callback(pullError, null as any);
      }
      return Promise.reject(pullError);
    });
    (mockDocker.modem.followProgress as vi.Mock).mockImplementation((_stream, cb) => cb(pullError));

    const props = getProps();
    await handleRunContainerTask(props as ActionHandlerProps);

    expect(putSystemMessage).toHaveBeenCalledWith('❌ Failed to pull Docker image: Image not found');
    expect(mockDocker.createContainer).not.toHaveBeenCalled();
  });

  it('should handle command execution failure', async () => {
    mockExec.inspect.mockResolvedValue({ ExitCode: 1 });
    mockGenerateContentFn
      .mockResolvedValueOnce([{ type: 'text', text: 'badcommand' }])
      .mockResolvedValueOnce([{ type: 'text', text: 'TASK_COMPLETE' }])
      .mockResolvedValueOnce([{ type: 'text', text: 'The task completed with a failed command.' }]);

    setTimeout(() => {
      mockStream.emit('data', Buffer.from('0200000000000012sh: badcommand: not found\\n'));
      mockStream.emit('end');
    }, 100);

    const props = getProps();
    await handleRunContainerTask(props as ActionHandlerProps);

    expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({ Cmd: ['/bin/sh', '-c', 'badcommand'] }));
    expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('Task finished with status: Success'));
    expect(putSystemMessage).toHaveBeenCalledWith(expect.stringContaining('The task completed with a failed command.'));
    expect(mockContainer.stop).toHaveBeenCalled();
  });
});
