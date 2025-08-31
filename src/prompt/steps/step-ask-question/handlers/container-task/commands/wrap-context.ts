import {
  FunctionCall,
  FunctionDef,
  GenerateContentFunction,
  ModelType,
  PromptItem,
} from '../../../../../../ai-service/common-types.js';
import { putContainerLog } from '../../../../../../main/common/content-bus.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from '../container-commands-types.js';
import { setExecutionPlanDef } from './set-execution-plan.js';
import { ActionHandlerProps } from '../../../step-ask-question-types.js';
import Docker from 'dockerode';

const MAX_CONTEXT_ITEMS = 24;
const WRAP_RATIO = 2 / 3;

export async function maybeWrapContext(
  systemPrompt: PromptItem,
  taskPrompt: PromptItem,
  taskExecutionPrompt: PromptItem[],
  generateContentFn: GenerateContentFunction,
  container: Docker.Container,
  options: ActionHandlerProps['options'],
) {
  if (taskExecutionPrompt.length < MAX_CONTEXT_ITEMS) {
    return;
  }

  putContainerLog('info', 'Context is getting long, wrapping it up.');

  await handleWrapContext({
    actionResult: {
      name: 'wrapContext',
      args: {}, // This will be populated by the LLM inside handleWrapContext
    },
    systemPrompt,
    taskPrompt,
    taskExecutionPrompt,
    container,
    options,
    generateContentFn,
    maxContextItems: MAX_CONTEXT_ITEMS,
    maxContextSize: 0, // not used
    maxOutputLength: 0, // not used
  });
}

const wrapContextInternalDef: FunctionDef = {
  name: 'wrapContextInternal',
  description: 'Internal tool to summarize the conversation history.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'A summary of prior steps and important findings to keep for next actions.',
      },
      plan: setExecutionPlanDef.parameters.properties.plan,
      progress: {
        type: 'string',
        description: 'What was achieved so far? What are the outcomes?',
      },
      importantFiles: {
        type: 'array',
        items: {
          type: 'string',
          description: `Paths to important files or directories to keep in mind for next actions.
It is critically IMPORTANT to keep track of files which are essential for the task. For example the files that were modified or created during the task so far.`,
        },
      },
      nextStep: {
        type: 'string',
        description: 'The next step to take in the process.',
      },
    },
    required: ['summary', 'plan', 'progress', 'importantFiles', 'nextStep'],
  },
};

interface HandleWrapContextProps extends CommandHandlerBaseProps {}

async function handleWrapContext(props: HandleWrapContextProps): Promise<CommandHandlerResult> {
  const { taskExecutionPrompt, generateContentFn, options, systemPrompt, taskPrompt } = props;

  let splitPoint = Math.floor(taskExecutionPrompt.length * WRAP_RATIO);

  // Adjust split point to not separate a function call from its response.
  // Iterate backwards from the middle to find a safe point that is not right after an assistant's function call.
  while (splitPoint > 0) {
    const precedingItem = taskExecutionPrompt[splitPoint - 1];
    if (precedingItem.type === 'assistant' && precedingItem.functionCalls?.length) {
      // This is an assistant message with a function call. It's unsafe to split right after it.
      // Move the split point before this message to keep the call and its subsequent response together.
      splitPoint--;
    } else {
      // This is a safe split point (e.g., after a user message or an assistant message without a call).
      break;
    }
  }

  const partToWrap = taskExecutionPrompt.slice(0, splitPoint);
  const partToKeep = taskExecutionPrompt.slice(splitPoint);

  if (partToWrap.length === 0) {
    // Nothing to wrap, probably because the first half was all function calls.
    return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
  }

  const summarizationPrompt: PromptItem[] = [
    systemPrompt,
    taskPrompt,
    ...partToWrap,
    {
      type: 'user',
      text: 'Please summarize the conversation so far. Include the current plan, progress, important files, and what the next immediate step should be, based on the last message.',
    },
  ];

  const response = await generateContentFn(
    summarizationPrompt,
    {
      functionDefs: [wrapContextInternalDef],
      requiredFunctionName: wrapContextInternalDef.name,
      modelType: ModelType.LITE,
    },
    options,
  );

  const wrapContextCall = (
    response
      .filter((item) => item.type === 'functionCall')
      .filter((item) => item.functionCall.name === wrapContextInternalDef.name)
      .map((item) => item.functionCall) as FunctionCall[]
  )[0];

  if (!wrapContextCall || !wrapContextCall.args) {
    putContainerLog('warn', 'Failed to generate a valid context summary.');
    // If summarization fails, we just keep the context as is to avoid breaking the flow.
    return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
  }

  putContainerLog('info', '🗂️ Context wrapped by internal operator.', wrapContextCall.args);

  const assistantMsg: PromptItem = {
    type: 'assistant',
    text: 'Wrapping context for continued processing. This summary will help maintain continuity, it contains the current plan, list of important files, and progress made so far, as well as the next step to take.',
    functionCalls: [{ name: 'wrapContext', args: wrapContextCall.args }],
  };
  const userResp: PromptItem = {
    type: 'user',
    text: `Please continue with the next step: ${wrapContextCall.args.nextStep}`,
    functionResponses: [
      {
        name: 'wrapContext',
        call_id: wrapContextCall.id || undefined,
      },
    ],
  };

  taskExecutionPrompt.splice(0, taskExecutionPrompt.length, assistantMsg, userResp, ...partToKeep);

  return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
}
