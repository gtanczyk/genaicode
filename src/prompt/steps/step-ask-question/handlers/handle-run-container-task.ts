import Docker from 'dockerode';
import { FunctionCall, GenerateContentArgs, PromptItem } from '../../../../ai-service/common-types.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';
import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../../../main/common/content-bus.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { getFunctionDefs } from '../../../function-calling.js';
import {
  runCommandDef,
  completeTaskDef,
  failTaskDef,
  wrapContextDef,
  setExecutionPlanDef,
  updateExecutionPlanDef,
  sendMessageDef,
  getCopyToContainerDef,
  getCopyFromContainerDef,
} from '../../../function-defs/container-task-commands.js';
import {
  pullImage,
  createAndStartContainer,
  executeCommand,
  stopContainer,
  copyToContainer,
  copyFromContainer,
  cleanupOrphanedContainers,
  listFilesInContainerArchive,
} from '../../../../utils/docker-utils.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { AllowedDockerImage } from '../../../function-defs/run-container-task.js';
import { estimateTokenCount } from '../../../../prompt/token-estimator.js';
import { askUserForConfirmation, askUserForInput } from '../../../../main/common/user-actions.js';

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
  stdin?: string;
  truncMode: 'start' | 'end';
  workingDir: string;
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

/** New utility action args */
export type WrapContextArgs = { summary: string };
export type SetExecutionPlanArgs = { plan: string };
export type UpdateExecutionPlanArgs = { progress: string };
export type SendMessageArgs = { message: string; isQuestion: boolean };

registerActionHandler('runContainerTask', handleRunContainerTask);
export type CopyToContainerArgs = {
  hostPath: string;
  containerPath: string;
};
export type CopyFromContainerArgs = {
  containerPath: string;
  hostPath: string;
};

export async function handleRunContainerTask({
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

    // First, use generateContentFn to get the proper runContainerTask arguments
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

    const confirmation = await askUserForConfirmation(`Do you want to run the task?`, true, options);

    if (!confirmation.confirmed) {
      putSystemMessage('Container task cancelled by user.');
      prompt.push(
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
        },
        {
          type: 'user',
          text: 'User cancelled the container task.',
        },
      );
      return { breakLoop: false, items: [] };
    }

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

      const finalMessage = `✅ Task finished with status: ${success ? 'Success' : 'Failed'}.\n\n**Summary:**\n${summary}`;

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
      putSystemMessage('❌ An error occurred during the container task', { error: errorMessage });

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

const MAX_CONTEXT_ITEMS = 25;
const MAX_CONTEXT_SIZE = 2048;

async function commandExecutionLoop(
  container: Docker.Container,
  taskDescription: string,
  generateContentFn: ActionHandlerProps['generateContentFn'],
  options: ActionHandlerProps['options'],
  waitIfPaused: ActionHandlerProps['waitIfPaused'],
): Promise<{ success: boolean; summary: string }> {
  let success = false;
  let summary = '';
  const maxCommands = 100;
  const taskExecutionPrompt: PromptItem[] = [];

  // Helper to truncate long content
  const maxOutputLength = 2048; // existing constraint used for outputs

  // Build the system prompt with best practices for context management
  const systemPrompt: PromptItem = {
    type: 'systemPrompt',
    systemPrompt: `You are an expert system operator inside a Docker container. Your task is to complete the objective by executing shell commands one at a time.

Best Practices:
- Be efficient: Plan your approach and minimize unnecessary commands
- Be incremental: Check results after each command before proceeding
- Be concise: Keep command outputs focused on the task
- Be mindful: Avoid generating excessive output that could overflow context
- Be adaptive: Adjust your strategy based on command results, including failures.
- Be meticulous: Pay attention to detail and ensure accuracy in all commands and responses.
- Don't give up: If a command fails, analyze the output and try to find a solution.
- Avoid waste: Clear unnecessary context to keep the conversation focused.
- Use reasoning: Provide clear reasoning for each command you execute.
- Think about the planet: Consider the environmental impact of your commands and strive for sustainability. Keep the context size below ${MAX_CONTEXT_ITEMS} messages or ${MAX_CONTEXT_SIZE} tokens, whichever is smaller.

You have access to the following functions:
- runCommand: Execute a shell command in the container, and wait for the result.
- completeTask: Mark the task as successfully completed with a summary
- failTask: Mark the task as failed with a reason
- wrapContext: Condense prior conversation into one succinct entry when context grows or after milestones. You can call this function only once in a while!
- setExecutionPlan: Record a brief plan to follow.
- updateExecutionPlan: Update plan progress and next steps.
- copyToContainer: Copy a file or directory from the host to the container. The hostPath must be absolute path container within project root.
- copyFromContainer: Copy a file or directory from the container to the host. The hostPath must be absolute path container within project root.

You may also provide reasoning text before function calls to explain your approach or analyze the current situation.`,
  };

  // Build the initial user message with task description only
  const taskPrompt: PromptItem = {
    type: 'user',
    text: `Overall Task:\n${taskDescription}\n\nBegin by analyzing the task and formulating your approach. Then start executing commands to complete it.`,
  };

  // Helper: collect texts from prompt items
  const collectTexts = (items: PromptItem[]): string[] => {
    const texts: string[] = [];
    for (const it of items) {
      if (it.type === 'systemPrompt' && it.systemPrompt) texts.push(it.systemPrompt);
      if (it.text) texts.push(it.text);
      if (it.functionResponses) {
        for (const fr of it.functionResponses) {
          if (fr.content) texts.push(fr.content);
        }
      }
    }
    return texts;
  };

  const computeContextMetrics = () => {
    const baseMessages = 2; // systemPrompt + taskPrompt
    const messageCount = baseMessages + taskExecutionPrompt.length;
    const allTexts = [
      ...(systemPrompt.systemPrompt ? [systemPrompt.systemPrompt] : []),
      ...(taskPrompt.text ? [taskPrompt.text] : []),
      ...collectTexts(taskExecutionPrompt),
    ];
    const estimatedTokens = allTexts.reduce((acc, t) => acc + estimateTokenCount(t), 0);
    return { messageCount, estimatedTokens };
  };

  const pushContextMetrics = () => {
    const { messageCount, estimatedTokens } = computeContextMetrics();
    putSystemMessage(`Context size: ${messageCount} messages; ~${estimatedTokens} tokens`);
    taskExecutionPrompt.push({
      type: 'user',
      text: `[context] messages: ${messageCount}; tokens: ~${estimatedTokens}`,
    });
    if (messageCount > MAX_CONTEXT_ITEMS) {
      taskExecutionPrompt.push({
        type: 'user',
        text: `[context] messages exceeded limit (${MAX_CONTEXT_ITEMS}).`,
      });
    }
    if (estimatedTokens > MAX_CONTEXT_SIZE) {
      taskExecutionPrompt.push({
        type: 'user',
        text: `[context] tokens exceeded limit (${MAX_CONTEXT_SIZE}).`,
      });
    }
    if (messageCount > MAX_CONTEXT_ITEMS || estimatedTokens > MAX_CONTEXT_SIZE) {
      taskExecutionPrompt.push({
        type: 'user',
        text: `[context] size exceeded limits: ${messageCount} messages, ${estimatedTokens} tokens. You must wrap the context using the wrapContext function!`,
      });
    }
  };

  let commandsExecuted = 0;

  for (let i = 0; i < maxCommands; i++) {
    try {
      await waitIfPaused();
      // Report current context metrics (to UI and to the model)
      pushContextMetrics();

      if (i === maxCommands - 10) {
        taskExecutionPrompt.push({
          type: 'user',
          text: `[context] nearing command limit of ${maxCommands}! 10 commands remaining! Start finishing up.`,
        });
      }

      const modelResponse = await generateContentFn(
        [systemPrompt, taskPrompt, ...taskExecutionPrompt],
        {
          functionDefs: [
            runCommandDef,
            completeTaskDef,
            failTaskDef,
            wrapContextDef,
            setExecutionPlanDef,
            updateExecutionPlanDef,
            sendMessageDef,
            getCopyToContainerDef(),
            getCopyFromContainerDef(),
          ],
          temperature: 0.7,
          modelType: ModelType.LITE,
          expectedResponseType: {
            text: true, // Allow text responses for reasoning
            functionCall: true,
            media: false,
          },
        },
        options,
      );

      const actionResults = modelResponse
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall) as Array<
        FunctionCall<
          | RunCommandArgs
          | CompleteTaskArgs
          | FailTaskArgs
          | WrapContextArgs
          | SetExecutionPlanArgs
          | UpdateExecutionPlanArgs
          | SendMessageArgs
          | CopyToContainerArgs
          | CopyFromContainerArgs
        >
      >;

      if (!actionResults || actionResults.length === 0) {
        putSystemMessage('❌ Internal LLM failed to produce a valid function call.');
        taskExecutionPrompt.push({
          type: 'assistant',
          text: 'I could not determine a valid action to take.',
        });
        taskExecutionPrompt.push({
          type: 'user',
          text: 'Please try again.',
        });
        continue;
      }

      let shouldBreakOuter = false;

      for (const actionResult of actionResults) {
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
          shouldBreakOuter = true;
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
          shouldBreakOuter = true;
          break;
        }

        if (actionResult.name === 'wrapContext') {
          const args = actionResult.args as WrapContextArgs | undefined;
          if (!args?.summary) {
            putSystemMessage('⚠️ wrapContext called without summary; ignoring.');
          } else {
            putSystemMessage('🗂️ Context wrapped by internal operator.', args);

            const assistantMsg: PromptItem = {
              type: 'assistant',
              text: 'Wrapping context for continued processing.',
              functionCalls: [actionResult],
            };
            const userResp: PromptItem = {
              type: 'user',
              functionResponses: [
                {
                  name: 'wrapContext',
                  call_id: actionResult.id || undefined,
                },
              ],
            };

            const previousWraps = taskExecutionPrompt.filter(
              (item) =>
                item.functionCalls?.some((call) => call.name === 'wrapContext') ||
                item.functionResponses?.some((resp) => resp.name === 'wrapContext'),
            );
            for (const wrap of previousWraps) {
              delete wrap.text;
              wrap.functionCalls = wrap.functionCalls?.filter((call) => call.name === 'wrapContext');
              wrap.functionResponses = wrap.functionResponses?.filter((resp) => resp.name === 'wrapContext');
            }

            taskExecutionPrompt.splice(0, taskExecutionPrompt.length);
            taskExecutionPrompt.push(...previousWraps, assistantMsg, userResp);

            const { messageCount, estimatedTokens } = computeContextMetrics();
            if (messageCount < MAX_CONTEXT_ITEMS && estimatedTokens < MAX_CONTEXT_SIZE) {
              userResp.text = `The context is within limits: ${messageCount} messages, ${estimatedTokens} tokens is less than the maximum allowed: ${MAX_CONTEXT_ITEMS} messages, ${MAX_CONTEXT_SIZE} tokens.`;
            }
          }
          continue;
        }

        if (actionResult.name === 'setExecutionPlan') {
          const args = actionResult.args as SetExecutionPlanArgs | undefined;
          if (!args?.plan) {
            putSystemMessage('⚠️ setExecutionPlan called without plan; ignoring.');
          } else {
            putSystemMessage('📝 Execution plan recorded.', args);

            taskExecutionPrompt.push(
              { type: 'assistant', text: 'Setting execution plan.', functionCalls: [actionResult] },
              {
                type: 'user',
                functionResponses: [{ name: 'setExecutionPlan', call_id: actionResult.id || undefined }],
              },
            );
          }
          continue;
        }

        if (actionResult.name === 'updateExecutionPlan') {
          const args = actionResult.args as UpdateExecutionPlanArgs | undefined;
          if (!args?.progress) {
            putSystemMessage('⚠️ updateExecutionPlan called without progress; ignoring.');
          } else {
            putSystemMessage('📈 Execution plan updated.', args);

            taskExecutionPrompt.push(
              { type: 'assistant', text: 'Updating execution plan.', functionCalls: [actionResult] },
              {
                type: 'user',
                functionResponses: [{ name: 'updateExecutionPlan', call_id: actionResult.id || undefined }],
              },
            );
          }
          continue;
        }

        if (actionResult.name === 'sendMessage') {
          const args = actionResult.args as SendMessageArgs;
          putAssistantMessage(args.message);

          taskExecutionPrompt.push({
            type: 'assistant',
            functionCalls: [actionResult],
          });

          if (args.isQuestion) {
            const response = await askUserForInput('Your answer', args.message, options);
            putUserMessage(response.answer);
            taskExecutionPrompt.push({
              type: 'user',
              text: response.answer,
              functionResponses: [
                {
                  name: 'sendMessage',
                  call_id: actionResult.id || undefined,
                },
              ],
            });
          } else {
            taskExecutionPrompt.push({
              type: 'user',
              functionResponses: [
                {
                  name: 'sendMessage',
                  call_id: actionResult.id || undefined,
                },
              ],
            });
          }

          continue;
        }

        if (actionResult.name === 'runCommand') {
          const args = actionResult.args as RunCommandArgs;
          const { command, workingDir, reasoning, stdin, truncMode } = args;

          if (commandsExecuted >= maxCommands) {
            putSystemMessage('⚠️ Reached maximum command limit.');
            summary = 'Task incomplete: Reached maximum command limit';
            shouldBreakOuter = true;
            break;
          }

          putSystemMessage(`💿 Executing command: ${reasoning}`, args);

          const { output, exitCode } = await executeCommand(container, command, stdin, workingDir);

          // Truncate excessive output to manage context size
          let managedOutput = output;
          if (output.length > maxOutputLength) {
            if (truncMode === 'start') {
              managedOutput =
                output.slice(0, maxOutputLength) + '\n\n[... output truncated for context management ...]';
            } else {
              managedOutput = '[... output truncated for context management ...]' + output.slice(-maxOutputLength);
            }
            putSystemMessage(`⚠️ Command output truncated (${output.length} -> ${managedOutput.length} chars)`);
          }

          putSystemMessage('Command executed', { managedOutput, exitCode });

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

          commandsExecuted++;
          continue;
        }

        if (actionResult.name === 'copyToContainer') {
          const args = actionResult.args as CopyToContainerArgs;
          putAssistantMessage(
            `Preparing to copy from host path "${args.hostPath}" to container path "${args.containerPath}".`,
          );
          const confirmation = await askUserForConfirmation(
            `Do you want to proceed with the copy operation?`,
            true,
            options,
          );

          if (!confirmation.confirmed) {
            putSystemMessage('Copy to container cancelled by user.');
            taskExecutionPrompt.push(
              {
                type: 'assistant',
                functionCalls: [actionResult],
              },
              {
                type: 'user',
                functionResponses: [
                  {
                    name: 'copyToContainer',
                    call_id: actionResult.id || undefined,
                    content: 'User cancelled the copy operation.',
                  },
                ],
              },
            );
            continue;
          }

          try {
            await copyToContainer(container, args.hostPath, args.containerPath);
            taskExecutionPrompt.push(
              {
                type: 'assistant',
                functionCalls: [actionResult],
              },
              {
                type: 'user',
                functionResponses: [
                  {
                    name: 'copyToContainer',
                    call_id: actionResult.id || undefined,
                    content: `Successfully copied ${args.hostPath} to container path ${args.containerPath}.`,
                  },
                ],
              },
            );
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            putSystemMessage('❌ Error copying to container', { error: errorMessage });
            taskExecutionPrompt.push(
              {
                type: 'assistant',
                functionCalls: [actionResult],
              },
              {
                type: 'user',
                functionResponses: [
                  {
                    name: 'copyToContainer',
                    call_id: actionResult.id || undefined,
                    content: `Error: ${errorMessage}`,
                  },
                ],
              },
            );
          }
          continue;
        }

        if (actionResult.name === 'copyFromContainer') {
          const args = actionResult.args as CopyFromContainerArgs;
          try {
            const filesToCopy = await listFilesInContainerArchive(container, args.containerPath);

            if (filesToCopy.length === 0) {
              const message = `No files found at container path "${args.containerPath}" to copy.`;
              putSystemMessage(message);
              taskExecutionPrompt.push(
                {
                  type: 'assistant',
                  functionCalls: [actionResult],
                },
                {
                  type: 'user',
                  functionResponses: [
                    {
                      name: 'copyFromContainer',
                      call_id: actionResult.id || undefined,
                      content: message,
                    },
                  ],
                },
              );
              continue;
            }

            const fileListStr = filesToCopy.map((f) => `  - ${f}`).join('\n');
            putAssistantMessage(
              `The following files will be copied from container path "${args.containerPath}" to host path "${args.hostPath}":\n${fileListStr}`,
            );
            const confirmation = await askUserForConfirmation(`Do you want to proceed?`, true, options);

            if (!confirmation.confirmed) {
              putSystemMessage('Copy from container cancelled by user.');
              taskExecutionPrompt.push(
                {
                  type: 'assistant',
                  functionCalls: [actionResult],
                },
                {
                  type: 'user',
                  functionResponses: [
                    {
                      name: 'copyFromContainer',
                      call_id: actionResult.id || undefined,
                      content: 'User cancelled the copy operation.',
                    },
                  ],
                },
              );
              continue;
            }

            await copyFromContainer(container, args.containerPath, args.hostPath);
            taskExecutionPrompt.push(
              {
                type: 'assistant',
                functionCalls: [actionResult],
              },
              {
                type: 'user',
                functionResponses: [
                  {
                    name: 'copyFromContainer',
                    call_id: actionResult.id || undefined,
                    content: `Successfully copied from container path ${args.containerPath} to ${args.hostPath}.`,
                  },
                ],
              },
            );
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            putSystemMessage('❌ Error copying from container', { error: errorMessage });
            taskExecutionPrompt.push(
              {
                type: 'assistant',
                functionCalls: [actionResult],
              },
              {
                type: 'user',
                functionResponses: [
                  {
                    name: 'copyFromContainer',
                    call_id: actionResult.id || undefined,
                    content: `Error: ${errorMessage}`,
                  },
                ],
              },
            );
          }
          continue;
        }

        // Unknown function call - log and continue
        putSystemMessage(`⚠️ Unknown function call received: ${actionResult.name}`);
        taskExecutionPrompt.push({
          type: 'user',
          functionResponses: [
            {
              name: actionResult.name,
              call_id: actionResult.id || undefined,
              content: `Unknown function call: ${actionResult.name}`,
            },
          ],
        });
      }

      if (shouldBreakOuter) {
        break;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      putSystemMessage('❌ Error during command execution loop', { error: errorMessage });
      summary = `Task failed: Error during execution - ${errorMessage}`;
      break;
    }
  }

  if (!summary) {
    summary = success ? 'Task completed' : 'Task failed or incomplete';
  }

  return { success, summary };
}
