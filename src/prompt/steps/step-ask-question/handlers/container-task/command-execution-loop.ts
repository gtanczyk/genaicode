import Docker from 'dockerode';
import { FunctionCall, ModelType, PromptItem } from '../../../../../ai-service/common-types.js';
import { putSystemMessage } from '../../../../../main/common/content-bus.js';
import { estimateTokenCount } from '../../../../token-estimator.js';
import { ActionHandlerProps } from '../../step-ask-question-types.js';
import {
  getContainerCommandDefs,
  getContainerCommandHandler,
  CommandHandlerBaseProps,
  HandleWrapContextProps,
  HandleRunCommandProps,
} from './container-commands-registry.js';

const MAX_CONTEXT_ITEMS = 25;
const MAX_CONTEXT_SIZE = 2048;
const MAX_OUTPUT_LENGTH = 2048;

export async function commandExecutionLoop(
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
- runCommand: Execute a shell command in the container, and wait for the result. Execute only non-interactive commands, otherwise you will wait indefinitely!
- completeTask: Mark the task as successfully completed with a summary
- failTask: Mark the task as failed with a reason
- wrapContext: Condense prior conversation into one succinct entry when context grows or after milestones. You can call this function only once in a while!
- setExecutionPlan: Record a brief plan to follow.
- updateExecutionPlan: Update plan progress and next steps.
- copyToContainer: Copy a file or directory from the host to the container. The hostPath must be absolute path container within project root.
- copyFromContainer: Copy a file or directory from the container to the host. The hostPath must be absolute path container within project root.

You may also provide reasoning text before function calls to explain your approach or analyze the current situation.`,
  };

  const taskPrompt: PromptItem = {
    type: 'user',
    text: `Overall Task:\n${taskDescription}\n\nBegin by analyzing the task and formulating your approach. Then start executing commands to complete it.`,
  };

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
    const messageCount =
      baseMessages +
      taskExecutionPrompt.filter((item) => !item.functionCalls?.some((fc) => fc.name !== 'wrapContext')).length;
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
          functionDefs: getContainerCommandDefs(),
          temperature: 0.7,
          modelType: ModelType.LITE,
          expectedResponseType: {
            text: true,
            functionCall: true,
            media: false,
          },
        },
        options,
      );

      const actionResults = modelResponse
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall) as Array<FunctionCall>;

      if (!actionResults || actionResults.length === 0) {
        putSystemMessage('❌ Internal LLM failed to produce a valid function call.');
        taskExecutionPrompt.push(
          {
            type: 'assistant',
            text: 'I could not determine a valid action to take.',
          },
          {
            type: 'user',
            text: 'Please try again.',
          },
        );
        continue;
      }

      let shouldBreakOuter = false;

      for (const actionResult of actionResults) {
        if (actionResult.name === 'runCommand' && commandsExecuted >= maxCommands) {
          putSystemMessage('⚠️ Reached maximum command limit.');
          summary = 'Task incomplete: Reached maximum command limit';
          shouldBreakOuter = true;
          break;
        }

        const handler = getContainerCommandHandler(actionResult.name);

        if (!handler) {
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
          continue;
        }

        // Prepare a comprehensive props object for the handler.
        // The handler will destructure and use only what it needs.
        const handlerProps: CommandHandlerBaseProps & Partial<HandleWrapContextProps> & Partial<HandleRunCommandProps> =
          {
            actionResult,
            taskExecutionPrompt,
            container,
            options,
            computeContextMetrics,
            maxContextItems: MAX_CONTEXT_ITEMS,
            maxContextSize: MAX_CONTEXT_SIZE,
            maxOutputLength: MAX_OUTPUT_LENGTH,
          };

        const handlerResult = await handler(handlerProps);

        if (handlerResult) {
          if (handlerResult.success !== undefined) success = handlerResult.success;
          if (handlerResult.summary !== undefined) summary = handlerResult.summary;
          commandsExecuted += handlerResult.commandsExecutedIncrement;
          if (handlerResult.shouldBreakOuter) {
            shouldBreakOuter = true;
            break;
          }
        }
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
