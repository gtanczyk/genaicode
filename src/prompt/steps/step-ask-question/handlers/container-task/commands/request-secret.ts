import path from 'path';
import { FunctionDef, PromptItem } from '../../../../../../ai-service/common-types.js';
import { putAssistantMessage, putContainerLog, putSystemMessage } from '../../../../../../main/common/content-bus.js';
import { askUserForSecret } from '../../../../../../main/common/user-actions.js';
import { executeCommand } from '../utils/docker-utils.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from '../container-commands-types.js';

export const requestSecretDef: FunctionDef = {
  name: 'requestSecret',
  description:
    'Requests a secret value from the user (e.g., API key). The value is then written to a specified file path inside the container. The secret value itself is NOT added to the conversation history for security.',
  parameters: {
    type: 'object',
    properties: {
      reasoning: {
        type: 'string',
        description: 'Explanation of why this secret is needed for the task.',
      },
      key: {
        type: 'string',
        description: 'A short, descriptive name for the secret being requested (e.g., "OPENAI_API_KEY").',
      },
      description: {
        type: 'string',
        description:
          'A user-friendly message explaining what secret is needed (e.g., "Please enter your OpenAI API key.").',
      },
      destinationFilePath: {
        type: 'string',
        description:
          'The absolute path inside the container where the secret should be saved (e.g., "/root/.config/openai/credentials").',
      },
    },
    required: ['reasoning', 'key', 'description', 'destinationFilePath'],
  },
};

type RequestSecretArgs = {
  reasoning: string;
  key: string;
  description: string;
  destinationFilePath: string;
};

const secretsRegistry: string[] = [];

export function sanitizePrompt(prompt: PromptItem[]): PromptItem[] {
  let json = JSON.stringify(prompt);
  for (const secret of secretsRegistry) {
    const escapedSecret = secret.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escapedSecret, 'g');
    json = json.replace(regex, '[REDACTED]');
  }
  return JSON.parse(json);
}

export function registerSecret(secret: string) {
  if (!secretsRegistry.includes(secret)) {
    secretsRegistry.push(secret);
  }
}

export async function handleRequestSecret(props: CommandHandlerBaseProps): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt, container } = props;
  const args = actionResult.args as RequestSecretArgs;
  const { reasoning, key, description, destinationFilePath } = args;

  putContainerLog('info', `Requesting secret: ${reasoning}`, args, 'command');

  const secretValue = await askUserForSecret(description);

  putAssistantMessage(description);

  if (secretValue) {
    putSystemMessage('Secret received. Writing to container...');
    registerSecret(secretValue);
    try {
      const dirname = path.dirname(destinationFilePath);
      const mkdirResult = await executeCommand(container, '/bin/sh', `mkdir -p "${dirname}"`, undefined, '/');
      if (mkdirResult.exitCode !== 0) {
        throw new Error(`Failed to create directory ${dirname}: ${mkdirResult.output}`);
      }

      const command = `tee "${destinationFilePath}"`;
      const result = await executeCommand(container, '/bin/sh', command, secretValue, '/');

      if (result.exitCode !== 0) {
        throw new Error(`Failed to write secret to file: ${result.output}`);
      }

      putContainerLog('success', `Secret "${key}" received and saved to ${destinationFilePath}.`);
      taskExecutionPrompt.push(
        {
          type: 'assistant',
          text: `Requesting secret with reasoning: ${reasoning}`,
          functionCalls: [actionResult],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'requestSecret',
              call_id: actionResult.id || undefined,
              content: `Secret for key "${key}" has been provided by the user and saved to ${destinationFilePath}.`,
            },
          ],
        },
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      putContainerLog('error', `Failed to save secret for key "${key}": ${errorMessage}`);
      taskExecutionPrompt.push(
        {
          type: 'assistant',
          text: `Requesting secret with reasoning: ${reasoning}`,
          functionCalls: [actionResult],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'requestSecret',
              call_id: actionResult.id || undefined,
              content: `Failed to save secret for key "${key}": ${errorMessage}`,
            },
          ],
        },
      );
    }
  } else {
    putSystemMessage('User cancelled providing the secret.');
    putContainerLog('warn', `User did not provide secret for key "${key}".`);
    taskExecutionPrompt.push(
      {
        type: 'assistant',
        text: `Requesting secret with reasoning: ${reasoning}`,
        functionCalls: [actionResult],
      },
      {
        type: 'user',
        functionResponses: [
          {
            name: 'requestSecret',
            call_id: actionResult.id || undefined,
            content: `User cancelled providing secret for key "${key}".`,
          },
        ],
      },
    );
  }

  return { shouldBreakOuter: false, commandsExecutedIncrement: 1 };
}
