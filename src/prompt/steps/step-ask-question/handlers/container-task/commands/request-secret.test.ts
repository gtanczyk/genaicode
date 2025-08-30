import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRequestSecret, registerSecret, sanitizePrompt } from './request-secret.js';
import { askUserForSecret } from '../../../../../../main/common/user-actions.js';
import { executeCommand } from '../utils/docker-utils.js';
import { putContainerLog } from '../../../../../../main/common/content-bus.js';
import { CommandHandlerBaseProps } from './complete-task.js';
import { PromptItem } from '../../../../../../ai-service/common-types.js';
import Dockerode from 'dockerode';

vi.mock('../../../../../../main/common/user-actions.js', () => ({
  askUserForSecret: vi.fn(),
}));

vi.mock('../utils/docker-utils.js', () => ({
  executeCommand: vi.fn(),
}));

vi.mock('../../../../../../main/common/content-bus.js', () => ({
  putContainerLog: vi.fn(),
  putSystemMessage: vi.fn(),
  putAssistantMessage: vi.fn(),
}));

describe('sanitizePrompt', () => {
  it('should redact secrets from the prompt', () => {
    registerSecret('OPENAI_API_KEY');
    const prompt: PromptItem[] = [
      {
        type: 'user',
        text: 'My API key is OPENAI_API_KEY',
      },
    ];
    const result = sanitizePrompt(prompt);
    expect(result).toEqual([
      {
        type: 'user',
        text: 'My API key is [REDACTED]',
      },
    ]);
  });
});

describe('handleRequestSecret', () => {
  let props: CommandHandlerBaseProps;
  let taskExecutionPrompt: PromptItem[];

  beforeEach(() => {
    vi.clearAllMocks();
    taskExecutionPrompt = [];
    props = {
      generateContentFn: vi.fn(),
      actionResult: {
        name: 'requestSecret',
        id: 'call_123',
        args: {
          reasoning: 'Need API key for service X',
          key: 'SERVICE_X_API_KEY',
          description: 'Please enter your API key for Service X',
          destinationFilePath: '/app/secrets/api.key',
        },
      },
      taskExecutionPrompt,
      container: {} as unknown as Dockerode.Container,
      options: {
        aiService: 'ai-studio',
        askQuestion: true,
      },
    };
  });

  it('should request and save a secret when the user provides one', async () => {
    vi.mocked(askUserForSecret).mockResolvedValue('my-secret-value');
    vi.mocked(executeCommand).mockResolvedValue({ exitCode: 0, output: '' });

    const result = await handleRequestSecret(props);

    expect(askUserForSecret).toHaveBeenCalledWith('Please enter your API key for Service X');
    expect(executeCommand).toHaveBeenCalledTimes(2);
    expect(executeCommand).toHaveBeenCalledWith(props.container, '/bin/sh', 'mkdir -p "/app/secrets"', undefined, '/');
    expect(executeCommand).toHaveBeenCalledWith(
      props.container,
      '/bin/sh',
      'tee "/app/secrets/api.key"',
      'my-secret-value',
      '/',
    );
    expect(putContainerLog).toHaveBeenCalledWith(
      'success',
      'Secret "SERVICE_X_API_KEY" received and saved to /app/secrets/api.key.',
    );
    expect(taskExecutionPrompt).toHaveLength(2);
    expect(taskExecutionPrompt[1].functionResponses?.[0].content).toBe(
      'Secret for key "SERVICE_X_API_KEY" has been provided by the user and saved to /app/secrets/api.key.',
    );
    expect(JSON.stringify(taskExecutionPrompt)).not.toContain('my-secret-value');
    expect(result).toEqual({ shouldBreakOuter: false, commandsExecutedIncrement: 1 });
  });

  it('should handle user cancellation when providing a secret', async () => {
    vi.mocked(askUserForSecret).mockResolvedValue(undefined);

    const result = await handleRequestSecret(props);

    expect(executeCommand).not.toHaveBeenCalled();
    expect(putContainerLog).toHaveBeenCalledWith('warn', 'User did not provide secret for key "SERVICE_X_API_KEY".');
    expect(taskExecutionPrompt).toHaveLength(2);
    expect(taskExecutionPrompt[1].functionResponses?.[0].content).toBe(
      'User cancelled providing secret for key "SERVICE_X_API_KEY".',
    );
    expect(result).toEqual({ shouldBreakOuter: false, commandsExecutedIncrement: 1 });
  });

  it('should handle failure when creating the destination directory', async () => {
    vi.mocked(askUserForSecret).mockResolvedValue('my-secret-value');
    vi.mocked(executeCommand).mockResolvedValueOnce({ exitCode: 1, output: 'Permission denied' });

    const result = await handleRequestSecret(props);

    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(putContainerLog).toHaveBeenCalledWith(
      'error',
      'Failed to save secret for key "SERVICE_X_API_KEY": Failed to create directory /app/secrets: Permission denied',
    );
    expect(taskExecutionPrompt).toHaveLength(2);
    expect(taskExecutionPrompt[1].functionResponses?.[0].content).toContain('Failed to save secret');
    expect(result).toEqual({ shouldBreakOuter: false, commandsExecutedIncrement: 1 });
  });

  it('should handle failure when writing the secret to the file', async () => {
    vi.mocked(askUserForSecret).mockResolvedValue('my-secret-value');
    vi.mocked(executeCommand)
      .mockResolvedValueOnce({ exitCode: 0, output: '' }) // mkdir success
      .mockResolvedValueOnce({ exitCode: 1, output: 'Read-only filesystem' }); // tee fail

    const result = await handleRequestSecret(props);

    expect(executeCommand).toHaveBeenCalledTimes(2);
    expect(putContainerLog).toHaveBeenCalledWith(
      'error',
      'Failed to save secret for key "SERVICE_X_API_KEY": Failed to write secret to file: Read-only filesystem',
    );
    expect(taskExecutionPrompt).toHaveLength(2);
    expect(taskExecutionPrompt[1].functionResponses?.[0].content).toContain('Failed to save secret');
    expect(result).toEqual({ shouldBreakOuter: false, commandsExecutedIncrement: 1 });
  });
});
