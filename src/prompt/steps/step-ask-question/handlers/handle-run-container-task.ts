import Docker from 'dockerode';
import { FunctionCall, GenerateContentArgs, PromptItem } from '../../../../ai-service/common-types.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { runCommandDef, completeTaskDef, failTaskDef } from '../../../function-defs/container-task-commands.js';
import { pullImage, createAndStartContainer, executeCommand, stopContainer } from '../../../../utils/docker-utils.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { AllowedDockerImage } from '../../../function-defs/run-container-task.js';

/**
 * Arguments for the runContainerTask action
 */
export type RunContainerTaskArgs = {
  image: AllowedDockerImage;
  taskDescription: string;
};

/**
 * Arguments for the runCommand action in container tasks
 */
export type RunCommandArgs = {
  command: string;
  reasoning: string;
};

/**
 * Arguments for the completeTask action in container tasks
 */
export type CompleteTaskArgs = {
  summary: string;
};

/**
 * Arguments for the failTask action in container tasks
 */
export type FailTaskArgs = {
  reason: string;
};

registerActionHandler('runContainerTask', handleRunContainerTask);

export async function handleRunContainerTask({
  askQuestionCall,
  prompt,
  generateContentFn,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  try {
    putSystemMessage('Container task: generating proper task request');

    // First, use generateContentFn to get the proper runContainerTask arguments
    const request: GenerateContentArgs = [
      [
        ...prompt,
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
        },
      ],
      {
        functionDefs: getFunctionDefs(),
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
    const [runContainerTaskCall] = response
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall) as [FunctionCall<RunContainerTaskArgs> | undefined];

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

    const { image, taskDescription } = runContainerTaskCall.args;
    const docker = new Docker({ socketPath: '/var/run/docker.sock' });

    putSystemMessage(`🐳 Starting container task with image: ${image}`);

    try {
      await pullImage(docker, image);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      putSystemMessage(`❌ Failed to pull Docker image: ${errorMessage}`);

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

      const { success, summary } = await commandExecutionLoop(container, taskDescription, generateContentFn, options);

      const finalMessage = `✅ Task finished with status: ${success ? 'Success' : 'Failed'}.

**Summary:**
${summary}`;

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
      return { breakLoop: true, items: [] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      putSystemMessage(`❌ An error occurred during the container task: ${errorMessage}`);

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
    // Handle errors gracefully
    const errorMessage = error instanceof Error ? error.message : String(error);
    putSystemMessage(`Error during container task initialization: ${errorMessage}`);

    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args!.message,
      },
      {
        type: 'user',
        text: `Error during container task initialization.`,
      },
    );

    return { breakLoop: true, items: [] };
  }
}

async function commandExecutionLoop(
  container: Docker.Container,
  taskDescription: string,
  generateContentFn: ActionHandlerProps['generateContentFn'],
  options: ActionHandlerProps['options'],
): Promise<{ success: boolean; summary: string }> {
  let success = false;
  let summary = '';
  const maxCommands = 25;
  const taskExecutionPrompt: PromptItem[] = [];

  // Build the system prompt with best practices for context management
  const systemPrompt: PromptItem = {
    type: 'systemPrompt',
    systemPrompt: `You are an expert system operator inside a Docker container. Your task is to complete the objective by executing shell commands one at a time.

Best Practices:
- Be efficient: Plan your approach and minimize unnecessary commands
- Be incremental: Check results after each command before proceeding
- Be concise: Keep command outputs focused on the task
- Be mindful: Avoid generating excessive output that could overflow context

You have access to the following functions:
- runCommand(command, reasoning): Execute a shell command in the container
- completeTask(summary): Mark the task as successfully completed with a summary
- failTask(reason): Mark the task as failed with a reason

Execute commands step by step to complete the task. After each command, you will see the output and can decide on the next command. When the task is complete or if you determine it cannot be completed, use the appropriate completion function.

You may also provide reasoning text before function calls to explain your approach or analyze the current situation.`,
  };

  // Build the initial user message with task description only
  const taskPrompt: PromptItem = {
    type: 'user',
    text: `Overall Task:
${taskDescription}

Begin by analyzing the task and formulating your approach. Then start executing commands to complete it.`,
  };

  // Context size management
  const maxContextItems = 50; // Limit the number of conversation items
  const maxOutputLength = 2048; // Limit individual command output length

  for (let i = 0; i < maxCommands; i++) {
    try {
      // Manage context size - keep only recent items if context grows too large
      let currentPrompt = taskExecutionPrompt;
      if (currentPrompt.length > maxContextItems) {
        // Keep the first few and last several items, removing middle ones
        const keepStart = 2;
        const keepEnd = maxContextItems - keepStart - 5;
        currentPrompt = [
          ...currentPrompt.slice(0, keepStart),
          {
            type: 'user',
            text: '[... earlier commands truncated for context management ...]',
          },
          ...currentPrompt.slice(-keepEnd),
        ];
      }

      const [actionResult] = (
        await generateContentFn(
          [systemPrompt, taskPrompt, ...currentPrompt],
          {
            functionDefs: [runCommandDef, completeTaskDef, failTaskDef],
            temperature: 0.7,
            modelType: ModelType.CHEAP,
            expectedResponseType: {
              text: true, // Allow text responses for reasoning
              functionCall: true,
              media: false,
            },
          },
          options,
        )
      )
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall) as [
        FunctionCall<RunCommandArgs | CompleteTaskArgs | FailTaskArgs> | undefined,
      ];

      if (!actionResult) {
        putSystemMessage('❌ Internal LLM failed to produce a valid function call.');
        summary = 'Task failed: AI system could not determine next action';
        break;
      }

      if (actionResult.name === 'completeTask') {
        const args = actionResult.args as CompleteTaskArgs;
        putSystemMessage('✅ Task marked as complete by internal operator.');
        success = true;
        summary = args.summary;

        taskExecutionPrompt.push(
          {
            type: 'assistant',
            text: 'Completing the task.',
            functionCalls: [actionResult],
          },
          {
            type: 'user',
            functionResponses: [
              {
                name: 'completeTask',
                call_id: actionResult.id || undefined,
                content: 'Task completed successfully.',
              },
            ],
          },
        );
        break;
      }

      if (actionResult.name === 'failTask') {
        const args = actionResult.args as FailTaskArgs;
        putSystemMessage('❌ Task marked as failed by internal operator.');
        success = false;
        summary = args.reason;

        taskExecutionPrompt.push(
          {
            type: 'assistant',
            text: 'Failing the task.',
            functionCalls: [actionResult],
          },
          {
            type: 'user',
            functionResponses: [
              {
                name: 'failTask',
                call_id: actionResult.id || undefined,
                content: 'Task marked as failed.',
              },
            ],
          },
        );
        break;
      }

      if (actionResult.name === 'runCommand') {
        const args = actionResult.args as RunCommandArgs;
        const { command, reasoning } = args;

        if (i === maxCommands - 1) {
          putSystemMessage('⚠️ Reached maximum command limit.');
          summary = 'Task incomplete: Reached maximum command limit';
          break;
        }

        putSystemMessage(`Executing command: \`\`\`sh\n${command}\n\`\`\``);
        putSystemMessage(`Reasoning: ${reasoning}`);

        const { output, exitCode } = await executeCommand(container, command);

        // Truncate excessive output to manage context size
        let managedOutput = output;
        if (output.length > maxOutputLength) {
          managedOutput = output.slice(0, maxOutputLength) + '\n\n[... output truncated for context management ...]';
          putSystemMessage(`⚠️ Command output truncated (${output.length} -> ${managedOutput.length} chars)`);
        }

        taskExecutionPrompt.push(
          {
            type: 'assistant',
            text: `Executing command with reasoning: ${reasoning}`,
            functionCalls: [actionResult],
          },
          {
            type: 'user',
            functionResponses: [
              {
                name: 'runCommand',
                call_id: actionResult.id || undefined,
                content: `Command executed successfully.\n\nOutput:\n${managedOutput}\n\nExit Code: ${exitCode}`,
              },
            ],
          },
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      putSystemMessage(`❌ Error during command execution loop: ${errorMessage}`);
      summary = `Task failed: Error during execution - ${errorMessage}`;
      break;
    }
  }

  if (!summary) {
    summary = success ? 'Task completed' : 'Task failed or incomplete';
  }

  return { success, summary };
}
