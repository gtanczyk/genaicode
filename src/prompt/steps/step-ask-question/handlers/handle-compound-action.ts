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
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { compoundActionListDef } from '../../../function-defs/compound-action-list.js';

export const handleCompoundAction: ActionHandler = async ({
  askQuestionCall,
  options,
  generateContentFn,
  prompt, // Include the current prompt context
}: ActionHandlerProps): Promise<ActionResult> => {
  const userRequestMessage = askQuestionCall.args?.message;

  if (!userRequestMessage) {
    putSystemMessage('Compound action requested but no user message provided to infer actions from.');
    return {
      breakLoop: false,
      items: [
        {
          assistant: { type: 'assistant', text: 'Could you please specify what actions you want me to perform?' },
          user: { type: 'user', text: 'No request provided.' },
        },
      ],
    };
  }

  // 1. Perform internal inference to generate the list of actions
  let actions: CompoundActionItem[] | undefined;
  try {
    putSystemMessage(`Inferring actions for request: "${userRequestMessage}"`);
    const inferencePrompt: PromptItem[] = [
      // Reuse relevant parts of the existing prompt for context
      ...prompt.filter(
        (item) => item.type !== 'assistant' || !item.functionCalls?.some((fc) => fc.name === 'askQuestion'),
      ),
      {
        type: 'user',
        text: `Based on the previous conversation and the last user request ("${userRequestMessage}"), generate a list of file operations (like createFile, updateFile, patchFile, deleteFile, moveFile) required to fulfill the request. Use the "compoundActionList" function to return the list.`,
      },
    ];

    const inferenceResult = await generateContentFn(
      inferencePrompt,
      {
        modelType: ModelType.CHEAP,
        functionDefs: [compoundActionListDef],
        requiredFunctionName: compoundActionListDef.name,
        temperature: 0.2, // Lower temperature for more deterministic action generation
        expectedResponseType: { text: false, functionCall: true, media: false },
      },
      options,
    );

    const compoundActionListCall = inferenceResult.find((part) => part.type === 'functionCall')?.functionCall as
      | FunctionCall<CompoundActionListArgs>
      | undefined;

    if (!compoundActionListCall?.args?.actions || compoundActionListCall.args.actions.length === 0) {
      throw new Error('AI failed to generate a list of actions or returned an empty list.');
    }
    actions = compoundActionListCall.args.actions;
    putSystemMessage(`Inferred actions: ${JSON.stringify(actions)}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    putSystemMessage(`Error during action inference: ${errorMessage}`);
    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: `I encountered an error while planning the actions: ${errorMessage}. Could you please clarify the request or try again?`,
          },
          user: { type: 'user', text: 'Inference failed.' },
        },
      ],
    };
  }

  // 2. Generate a summary message for confirmation
  let summary = `Okay, based on your request ("${userRequestMessage}"), here are the actions I plan to take:\n\n`;
  actions.forEach((action, index) => {
    // Provide more detail in the summary
    summary += `${index + 1}. **${action.actionName}**:
   - Parameters: ${JSON.stringify(action.params)}
`;
    // TODO: Potentially add more details like file paths if easily extractable
  });
  summary += '\nDo you want to execute all these actions?';

  // 3. Request confirmation
  const confirmation = await askUserForConfirmation(summary, true, options, 'Yes, execute all', 'No, cancel');

  if (!confirmation.confirmed) {
    putSystemMessage('User declined compound action execution.');
    return {
      breakLoop: false,
      items: [
        {
          assistant: { type: 'assistant', text: 'Okay, I will cancel the proposed actions.' },
          user: { type: 'user', text: 'User declined.' },
        },
      ],
    };
  }

  // 4. Execute actions if confirmed
  putSystemMessage('User confirmed compound action execution. Proceeding...');
  let executionError: Error | null = null;
  let errorMessage = '';

  for (const [index, action] of actions.entries()) {
    putSystemMessage(`Executing action ${index + 1}/${actions.length}: ${action.actionName}`);
    const executor = getOperationExecutor(action.actionName);
    if (!executor) {
      errorMessage = `Error: Operation executor not found for action \\"${action.actionName}\\". Skipping this action.`;
      putSystemMessage(errorMessage);
      // Optionally, stop the whole batch on missing executor
      // executionError = new Error(errorMessage);
      // break;
      continue; // Continue with the next action
    }

    try {
      // Ensure params are passed correctly
      await executor(action.params, options);
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

  return {
    breakLoop: false, // Continue conversation after batch execution (or failure)
    items: [
      {
        assistant: { type: 'assistant', text: finalAssistantMessage },
        user: { type: 'user', text: executionError ? 'Error occurred' : 'Actions executed.' },
      },
    ],
  };
};

// Register the handler
registerActionHandler('compoundAction', handleCompoundAction);
