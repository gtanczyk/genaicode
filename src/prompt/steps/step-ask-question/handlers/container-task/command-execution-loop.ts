import Docker from 'dockerode';
import {
  FunctionCall,
  GenerateContentFunction,
  ModelType,
  PromptItem,
} from '../../../../../ai-service/common-types.js';
import {
  putAssistantMessage,
  putContainerLog,
  putSystemMessage,
  putUserMessage,
} from '../../../../../main/common/content-bus.js';
import { abortController } from '../../../../../main/common/abort-controller.js';
import { ActionHandlerProps } from '../../step-ask-question-types.js';
import { getContainerCommandDefs, getContainerCommandHandler } from './container-commands-registry.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from './container-commands-types.js';
import { rcConfig } from '../../../../../main/config.js';
import { clearInterruption, isInterrupted } from './commands/interrupt-controller.js';
import { askUserForInput } from '../../../../../main/common/user-actions.js';
import { sanitizePrompt } from './commands/request-secret.js';
import { maybeQueryKnowledge } from './commands/query-knowledge.js';
import { maybeGainKnowledge } from './commands/gain-knowledge.js';
import { maybeWrapContext } from './commands/wrap-context.js';
import { HandleRunCommandProps } from './commands/run-command.js';

const MAX_CONTEXT_ITEMS = 50;
const MAX_CONTEXT_SIZE = 2048;
const MAX_OUTPUT_LENGTH = 2048;

export async function commandExecutionLoop(
  container: Docker.Container,
  taskDescription: string,
  unsanitizedGenerateContentFn: ActionHandlerProps['generateContentFn'],
  options: ActionHandlerProps['options'],
  waitIfPaused: ActionHandlerProps['waitIfPaused'],
): Promise<{ success: boolean; summary: string }> {
  let success = false;
  let summary = '';
  const maxCommands = 200;
  const taskExecutionPrompt: PromptItem[] = [];
  const isAborted = () => abortController?.signal.aborted === true;

  const generateContentFn: GenerateContentFunction = (prompt, ...args) =>
    unsanitizedGenerateContentFn(sanitizePrompt(prompt), ...args);

  const systemPrompt: PromptItem = {
    type: 'systemPrompt',
    systemPrompt: `You are Genaicode, an expert system operator inside a Docker container. Your task is to complete the objective by executing shell commands one at a time. You help the user achieve their goals given the superpower of running bash in secure Docker container environment, which allows you to do anything you want or what is needed. Starting from running basic commands, through creating new files and directories, to installing software and configuring the environment.

Best Practices:
- Be efficient: Plan your approach and minimize unnecessary commands. Write down your plan, keep it up to date.
- Be incremental: Check results after each command before proceeding
- Be concise: Keep command outputs focused on the task
- Be mindful: Avoid generating excessive output that could overflow context
- Be adaptive: Adjust your strategy based on command results, including failures.
- Be meticulous: Pay attention to detail and ensure accuracy in all commands and responses.
- Don't give up: If a command fails, analyze the output and try to find a solution.
- Use reasoning: Provide clear reasoning for each command you execute.
- FFS! Communicate! It means you should keep the user informed about what you are doing and why, and adjust your approach based on their feedback.
- Don't be passive aggressive, it doesn't help anyone. Help the user achieve their goals, even if you encounter obstacles.
- Let the user have a life, outside of this task, and avoid unnecessary interruptions, or bothering them with irrelevant details, especially if you can find a solution without involving them.
- SFTU! You have the possibility to search the web for solutions or information.
- Be careful about secrets and sensitive information, never expose them in your commands or outputs.
- Reuse existing knowledge and solutions from the knowledge base to avoid reinventing the wheel.
- Every corrected mistake, fixed problem, or learned lesson - no matter how small - may be worth documenting in the knowledge base.

You have access to the following functions:
- runCommand: Execute a shell command in the container, and wait for the result. Execute only non-interactive commands, otherwise you will wait indefinitely!
- completeTask: Mark the task as successfully completed with a summary
- failTask: Mark the task as failed with a reason
- setExecutionPlan: Record a brief plan to follow.
- updateExecutionPlan: Update plan progress and next steps.
- copyToContainer: Copy a file or directory from the host to the container. The hostPath must be absolute path container within project root.
- copyFromContainer: Copy a file or directory from the container to the host. The hostPath must be absolute path container within project root.
- sendMessage: Use it to communicate with the user, either to inform them about something, or ask them a question. Think if asking user about something is really necessary before doing it (maybe you can find the answer yourself?)
- webSearch: Perform a web search given an exhaustive prompt. Return a concise, grounded answer and a list of source URLs used. The answer is not displayed to the user. It should be used to inform following actions.
- requestSecret: Ask the user to provide a secret value (e.g. API key) and write it to a specified file path in the container. The file path must be absolute path within the container.
- gainKnowledge: Persist a new knowledge entry in the knowledge base capturing a prompt, its answer/insight, and optional metadata. Use this to record successful operations, solutions to problems, or any other valuable information that could help in future tasks. Avoid storing secrets.
- queryKnowledge: Query the knowledge base with a natural language prompt to find relevant information from past tasks. Use this to check for existing solutions before attempting a complex step.

You may also provide reasoning text before function calls to explain your approach or analyze the current situation.

The container starts fresh with a clean state and no prior context. You need to setup the container to perform the task described in the user prompt.
If the task requires current project source code(located in ${rcConfig.rootDir}) then you may need to copy it from host to the container.
Outcomes of your work can be provided in two ways back to the current project:
- Provide comprehensive description of the outcome in completeTask function call.
- Copy the relevant files or directories from the container to the host using copyFromContainer function call.
`,
  };

  const taskPrompt: PromptItem = {
    type: 'user',
    text: `Overall Task:
${taskDescription}

Begin by analyzing the task and formulating your approach. Then start executing commands to complete it.`,
  };

  await maybeQueryKnowledge({
    actionResult: { name: 'queryKnowledge' }, // Placeholder, ignored by maybeQueryKnowledge
    taskExecutionPrompt,
    systemPrompt,
    taskPrompt,
    generateContentFn,
    container,
    options,
    maxContextItems: MAX_CONTEXT_ITEMS,
    maxContextSize: MAX_CONTEXT_SIZE,
    maxOutputLength: MAX_OUTPUT_LENGTH,
  });

  let commandsExecuted = 0;
  let periodicQueryPromise: Promise<CommandHandlerResult> | null = null;

  for (let i = 0; i < maxCommands; i++) {
    try {
      if (periodicQueryPromise) {
        await periodicQueryPromise;
        periodicQueryPromise = null;
      }

      if (isAborted()) {
        putContainerLog('warn', 'Task cancelled by user. Exiting command loop.');
        summary = 'Task cancelled by user';
        break;
      }

      await waitIfPaused();

      if (isInterrupted()) {
        clearInterruption();
        putSystemMessage('Task interrupted, waiting for user input');
        putAssistantMessage('What would you like to do?');
        const response = await askUserForInput('Your answer', '', options);
        const item: PromptItem = {
          type: 'user',
          text: response.answer,
          images: response.images,
        };
        putUserMessage(response.answer ?? '', undefined, undefined, response.images, item);
        taskExecutionPrompt.push(item);
      }

      if (
        i > 0 &&
        i % 10 === 0 &&
        !taskExecutionPrompt.find((item) => item.functionCalls?.some((fc) => fc.name === 'queryKnowledge'))
      ) {
        periodicQueryPromise = maybeQueryKnowledge({
          actionResult: { name: 'queryKnowledge' }, // Placeholder
          taskExecutionPrompt,
          systemPrompt,
          taskPrompt,
          generateContentFn,
          container,
          options,
          maxContextItems: MAX_CONTEXT_ITEMS,
          maxContextSize: MAX_CONTEXT_SIZE,
          maxOutputLength: MAX_OUTPUT_LENGTH,
        }).catch((err) => {
          putContainerLog('error', 'Periodic knowledge query failed in background', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      if (i === maxCommands - 10) {
        taskExecutionPrompt.push({
          type: 'user',
          text: `[context] nearing command limit of ${maxCommands}! 10 commands remaining! Start finishing up.`,
        });
      }

      await maybeWrapContext(systemPrompt, taskPrompt, taskExecutionPrompt, generateContentFn, container, options);

      if (isAborted()) {
        putContainerLog('warn', 'Task cancelled by user before model call.');
        summary = 'Task cancelled by user';
        break;
      }

      const modelResponse = await generateContentFn(
        [systemPrompt, taskPrompt, ...taskExecutionPrompt],
        {
          functionDefs: getContainerCommandDefs(),
          temperature: 0.7,
          modelType:
            taskExecutionPrompt.length <= 2
              ? ModelType.DEFAULT
              : taskExecutionPrompt.length <= 5
                ? ModelType.CHEAP
                : ModelType.LITE,
          expectedResponseType: {
            text: false,
            functionCall: true,
            media: false,
          },
        },
        options,
      );

      if (isAborted()) {
        putContainerLog('warn', 'Task cancelled by user after model call.');
        summary = 'Task cancelled by user';
        break;
      }

      const actionResults = modelResponse
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall) as Array<FunctionCall>;

      if (!actionResults || actionResults.length === 0) {
        putContainerLog('error', 'Internal LLM failed to produce a valid function call.');
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
          putContainerLog('warn', 'Reached maximum command limit.');
          putSystemMessage('⚠️ Task incomplete: Reached maximum command limit');
          summary = 'Task incomplete: Reached maximum command limit';
          shouldBreakOuter = true;
          break;
        }

        const handler = getContainerCommandHandler(actionResult.name);

        if (!handler) {
          putContainerLog('warn', `Unknown function call received: ${actionResult.name}`);
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

        const handlerProps: CommandHandlerBaseProps & Partial<HandleRunCommandProps> = {
          actionResult,
          systemPrompt,
          taskPrompt,
          taskExecutionPrompt,
          container,
          options,
          generateContentFn,
          maxContextItems: MAX_CONTEXT_ITEMS,
          maxContextSize: MAX_CONTEXT_SIZE,
          maxOutputLength: MAX_OUTPUT_LENGTH,
        };

        const handlerResult = await handler(handlerProps);

        if (handlerResult) {
          if (handlerResult.success !== undefined) success = handlerResult.success;
          if (handlerResult.summary !== undefined) summary = handlerResult.summary;
          commandsExecuted += handlerResult.commandsExecutedIncrement ?? 0;
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
      putContainerLog('error', 'Error during command execution loop', { error: errorMessage });
      putSystemMessage('❌ Error during command execution loop', { error: errorMessage });
      summary = `Task failed: Error during execution - ${errorMessage}`;
      break;
    }
  }

  maybeGainKnowledge({
    actionResult: {
      name: 'gainKnowledge', // Placeholder
    },
    systemPrompt,
    taskPrompt,
    taskExecutionPrompt,
    generateContentFn,
    container,
    options,
    maxContextItems: MAX_CONTEXT_ITEMS,
    maxContextSize: MAX_CONTEXT_SIZE,
    maxOutputLength: MAX_OUTPUT_LENGTH,
    taskDescription,
    summary,
  }).catch((err) => {
    putContainerLog('error', 'maybeGainKnowledge failed in background', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  try {
    const modelResponse = await generateContentFn(
      [
        systemPrompt,
        taskPrompt,
        ...taskExecutionPrompt,
        {
          type: 'user',
          text: 'Please provide a concise summary of the outcomes of the task',
        },
      ],
      {
        functionDefs: getContainerCommandDefs(),
        temperature: 0.7,
        modelType: ModelType.LITE,
        expectedResponseType: {
          text: true,
          functionCall: false,
          media: false,
        },
      },
      options,
    );
    for (const item of modelResponse) {
      if (item.type === 'text' && item.text) {
        const text = item.text.length > 1000 ? item.text.substring(0, 1000) + '...' : item.text;
        putContainerLog('info', 'Final wrap-up summary from the model', { text });
        summary = text;
        break;
      }
    }
  } catch (error) {
    putContainerLog('error', 'Error during post-loop wrap-up', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!summary) {
    summary = success ? 'Task completed' : 'Task failed or incomplete';
  }

  return { success, summary };
}
