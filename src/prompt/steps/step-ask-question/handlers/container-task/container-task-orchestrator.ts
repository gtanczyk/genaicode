import Docker from 'dockerode';
import { FunctionCall, GenerateContentArgs, ModelType } from '../../../../../ai-service/common-types.js';
import { putAssistantMessage, putContainerLog, putSystemMessage } from '../../../../../main/common/content-bus.js';
import { askUserForConfirmationWithAnswer } from '../../../../../main/common/user-actions.js';
import { abortController } from '../../../../../main/common/abort-controller.js';
import { RunContainerTaskArgs, runContainerTaskDef } from '../../../../function-defs/run-container-task.js';
import {
  cleanupOrphanedContainers,
  createAndStartContainer,
  pullImage,
  stopContainer,
} from '../../../../../utils/docker-utils.js';
import { ActionHandlerProps, ActionResult } from '../../step-ask-question-types.js';
import { commandExecutionLoop } from './command-execution-loop.js';

export async function runContainerTaskOrchestrator({
  askQuestionCall,
  prompt,
  generateContentFn,
  options,
  waitIfPaused,
}: ActionHandlerProps): Promise<ActionResult> {
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });
  await cleanupOrphanedContainers(docker);

  if (abortController?.signal.aborted) {
    putContainerLog('warn', 'Container task aborted before start.');
    putSystemMessage('Container task aborted before start.');
    return { breakLoop: false, items: [] };
  }

  try {
    putContainerLog('info', 'Container task: generating proper task request');

    const request: GenerateContentArgs = [
      [
        ...prompt,
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
        },
        {
          type: 'user',
          text: 'I understand that you want to run a container task. Please provide the Docker image and task description.',
        },
      ],
      {
        functionDefs: [runContainerTaskDef],
        requiredFunctionName: 'runContainerTask',
        temperature: 0.7,
        modelType: ModelType.CHEAP,
        expectedResponseType: {
          text: false,
          functionCall: true,
          media: false,
        },
      },
      options,
    ];

    const response = await generateContentFn(...request);
    const runContainerTaskCall = (
      response
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall) as FunctionCall<RunContainerTaskArgs>[]
    ).find((call) => call.name === 'runContainerTask');

    if (!runContainerTaskCall?.args?.image || !runContainerTaskCall.args.taskDescription) {
      putContainerLog('error', 'Failed to get valid runContainerTask request');
      putSystemMessage('❌ Failed to get valid runContainerTask request');

      prompt.push(
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
        },
        {
          type: 'user',
          text: 'Failed to get valid runContainerTask request',
        },
      );
      return { breakLoop: false, items: [] };
    }

    putAssistantMessage(
      `I would like to run a container task with image: ${runContainerTaskCall.args.image}\n\nTask description:\n\n${runContainerTaskCall.args.taskDescription}`,
    );

    const confirmation = await askUserForConfirmationWithAnswer(
      `Do you want to run the task?`,
      'Yes',
      'No',
      true,
      options,
    );

    if (!confirmation.confirmed) {
      putContainerLog('warn', 'Container task cancelled by user.');
      putSystemMessage('Container task cancelled by user.');
      prompt.push(
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
        },
        {
          type: 'user',
          text: 'I reject running the container task.' + (confirmation.answer ? ` ${confirmation.answer}` : ''),
        },
      );
      return { breakLoop: false, items: [] };
    }

    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args!.message,
      },
      {
        type: 'user',
        text: 'I accept running the container task.' + (confirmation.answer ? ` ${confirmation.answer}` : ''),
      },
    );

    const { image, taskDescription } = runContainerTaskCall.args;

    putContainerLog('info', `Starting container task with image: ${image}`);
    putSystemMessage(`🐳 Starting container task with image: ${image}`);

    if (abortController?.signal.aborted) {
      putContainerLog('warn', 'Container task aborted before pulling image.');
      putSystemMessage('Container task aborted by user.');
      return { breakLoop: false, items: [] };
    }

    try {
      await pullImage(docker, image);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      putSystemMessage('❌ Failed to pull Docker image', { error: errorMessage });
      // The pullImage function already logs the detailed error to the terminal.

      prompt.push(
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
          functionCalls: [runContainerTaskCall],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'runContainerTask',
              call_id: runContainerTaskCall.id || undefined,
              content: `Failed to pull Docker image: ${errorMessage}`,
            },
          ],
        },
      );
      return { breakLoop: false, items: [] };
    }

    let container: Docker.Container | undefined;
    let onAbort: (() => void) | undefined;
    try {
      container = await createAndStartContainer(docker, image);

      onAbort = () => {
        putContainerLog('warn', 'Execution interrupted by user. Stopping container...', undefined, 'docker');
        // Best-effort stop; stopContainer is idempotent/safe via try/catch
        if (container) {
          stopContainer(container).catch(() => {});
        }
      };
      abortController?.signal.addEventListener('abort', onAbort);

      putContainerLog('info', 'Entering command execution loop.');
      const { success, summary } = await commandExecutionLoop(
        container,
        taskDescription,
        generateContentFn,
        options,
        waitIfPaused,
      );

      const finalMessage = `✅ Task finished with status: ${
        success ? 'Success' : 'Failed'
      }.\n\n**Summary:**\n${summary}`;

      putContainerLog(success ? 'success' : 'error', `Task finished. Summary: ${summary}`);
      putSystemMessage(finalMessage);

      prompt.push(
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
          functionCalls: [runContainerTaskCall],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'runContainerTask',
              call_id: runContainerTaskCall.id || undefined,
              content: finalMessage,
            },
          ],
        },
      );
      return { breakLoop: false, items: [] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      putContainerLog('error', 'An error occurred during the container task', { error: errorMessage });
      putSystemMessage('❌ An error occurred during the container task', {
        error: errorMessage,
      });

      prompt.push(
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
          functionCalls: [runContainerTaskCall],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'runContainerTask',
              call_id: runContainerTaskCall.id || undefined,
              content: `An error occurred during the container task: ${errorMessage}`,
            },
          ],
        },
      );
      return { breakLoop: false, items: [] };
    } finally {
      if (container) {
        await stopContainer(container);
        if (onAbort) {
          abortController?.signal.removeEventListener('abort', onAbort);
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    putContainerLog('error', 'Error during container task initialization', { error: errorMessage });
    putSystemMessage('Error during container task initialization', { error: errorMessage });

    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args!.message,
      },
      {
        type: 'user',
        text: `Error during container task initialization: ${errorMessage}`,
      },
    );

    return { breakLoop: false, items: [] };
  }
}
