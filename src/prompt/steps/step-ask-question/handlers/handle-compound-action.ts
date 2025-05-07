import { FunctionCall, ModelType, PromptItem } from '../../../../ai-service/common-types.js';
import {
  ActionHandler,
  ActionResult,
  ActionHandlerProps,
  CompoundActionItem,
  CompoundActionListArgs,
} from '../step-ask-question-types.js';
import { askUserForConfirmation } from '../../../../main/common/user-actions.js';
import { getOperationExecutor } from '../../../../operations/operations-index.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { putAssistantMessage, putSystemMessage } from '../../../../main/common/content-bus.js';
import { getCompoundActionListDef } from '../../../function-defs/compound-action-list.js';
import { getFunctionDefs } from '../../../function-calling.js';

export const handleCompoundAction: ActionHandler = async ({
  askQuestionCall,
  options,
  generateContentFn,
  prompt, // Include the current prompt context
}: ActionHandlerProps): Promise<ActionResult> => {
  // 1. Perform internal inference to generate the list of actions
  let compoundActionListCall: FunctionCall<CompoundActionListArgs> | undefined;
  let actions: CompoundActionItem[] | undefined;
  let summary: string | undefined;
  try {
    putSystemMessage(`Inferring actions based on the current conversation context.`);
    const inferencePrompt: PromptItem[] = [
      ...prompt,
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: `Based on the provided conversation history, generate a list of file operations (like createFile, updateFile, patchFile, deleteFile, moveFile) required to fulfill the user's intent expressed in the conversation. Use the "compoundActionList" function to return the list.`,
      },
    ];

    const inferenceResult = await generateContentFn(
      inferencePrompt,
      {
        modelType: ModelType.CHEAP,
        functionDefs: getFunctionDefs(),
        requiredFunctionName: getCompoundActionListDef().name,
        temperature: 0.2, // Lower temperature for more deterministic action generation
        expectedResponseType: { text: false, functionCall: true, media: false },
      },
      options,
    );

    compoundActionListCall = inferenceResult.find((part) => part.type === 'functionCall')?.functionCall as
      | FunctionCall<CompoundActionListArgs>
      | undefined;

    if (!compoundActionListCall?.args?.actions || compoundActionListCall.args.actions.length === 0) {
      throw new Error('AI failed to generate a list of actions or returned an empty list.');
    }
    actions = compoundActionListCall.args.actions;
    summary = compoundActionListCall.args.summary;
    putSystemMessage(`Inferred actions`, { actions });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    putSystemMessage(`Error during action inference: ${errorMessage}`);
    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: `I encountered an error while inferring actions: ${errorMessage}. Please clarify your request.`,
      },
    );
    return {
      breakLoop: false,
      items: [],
    };
  }

  prompt.push({
    type: 'assistant',
    text: askQuestionCall.args?.message ?? '',
    functionCalls: [compoundActionListCall],
  });

  // 2. Request confirmation
  const confirmation = await askUserForConfirmation(summary!, true, options, 'Yes, execute all', 'No, cancel');

  putAssistantMessage(summary!);

  if (!confirmation.confirmed) {
    putSystemMessage('User declined compound action execution.');
    prompt.push({
      type: 'user',
      text: `User declined the proposed actions. ${confirmation.answer}`,
      functionResponses: [
        {
          name: compoundActionListCall.name,
          call_id: compoundActionListCall.id,
        },
      ],
    });
    return {
      breakLoop: false,
      items: [],
    };
  }

  // 3. Execute actions if confirmed
  putSystemMessage('User confirmed compound action execution. Proceeding...');
  let executionError: Error | null = null;
  let errorMessage = '';

  for (const [index, action] of actions.entries()) {
    putSystemMessage(`Executing action ${index + 1}/${actions.length}: ${action.actionName}`);
    const executor = getOperationExecutor(action.actionName);
    if (!executor) {
      errorMessage = `Error: Operation executor not found for action "${action.actionName}". Skipping this action.`;
      putSystemMessage(errorMessage);
      // Optionally, stop the whole batch on missing executor
      // executionError = new Error(errorMessage);
      // break;
      continue; // Continue with the next action
    }

    try {
      // Ensure params are passed correctly
      await executor(Object.fromEntries(action.params.map((param) => [param.paramName, param.paramValue])), options);
      putSystemMessage(`Action ${action.actionName} completed successfully.`);
    } catch (error) {
      executionError = error instanceof Error ? error : new Error(String(error));
      errorMessage = `Error executing action ${index + 1} (${action.actionName}): ${executionError.message}. Stopping batch execution.`;
      putSystemMessage(errorMessage);
      break; // Stop execution on the first error
    }
  }

  const finalAssistantMessage = executionError
    ? `Failed to execute the batch: ${errorMessage}`
    : 'Successfully executed all actions in the batch.';

  prompt.push(
    {
      type: 'user',
      text: `User confirmed the actions. ${confirmation.answer}`,
      functionResponses: [
        {
          name: compoundActionListCall.name,
          call_id: compoundActionListCall.id,
        },
      ],
    },
    {
      type: 'assistant',
      text: finalAssistantMessage,
    },
    {
      type: 'user',
      text: 'Thank you for executing the actions, lets continue with the conversation.',
    },
  );

  return {
    breakLoop: false, // Continue conversation after batch execution (or failure)
    items: [],
  };
};

// Register the handler
registerActionHandler('compoundAction', handleCompoundAction);
