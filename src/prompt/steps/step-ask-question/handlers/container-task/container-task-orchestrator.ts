import Docker from 'dockerode';
import { FunctionCall, GenerateContentArgs, ModelType } from '../../../../../ai-service/common-types.js';
import { putAssistantMessage, putSystemMessage } from '../../../../../main/common/content-bus.js';
import { askUserForConfirmationWithAnswer } from '../../../../../main/common/user-actions.js';
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

  try {
    putSystemMessage('Container task: generating proper task request');

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

    putSystemMessage(`🐳 Starting container task with image: ${image}`);

    try {
      await pullImage(docker, image);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      putSystemMessage('❌ Failed to pull Docker image', { error: errorMessage });

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
    try {
      container = await createAndStartContainer(docker, image);

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
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
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
