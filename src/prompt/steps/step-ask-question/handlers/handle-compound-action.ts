import { FunctionCall, ModelType, PromptItem, FunctionDef } from '../../../../ai-service/common-types.js';
import { ActionHandler, ActionResult, ActionHandlerProps, CompoundActionItem } from '../step-ask-question-types.js';
import { askUserForConfirmation } from '../../../../main/common/user-actions.js';
import { getOperationExecutor, getOperationDefs } from '../../../../operations/operations-index.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { putAssistantMessage, putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';

// Helper FunctionDef for initial high-level plan inference
const inferActionTypesAndSummaryDef: FunctionDef = {
  name: 'inferActionTypesAndSummary',
  description: 'Infers the types of actions required and a summary for user confirmation.',
  parameters: {
    type: 'object',
    properties: {
      actionNames: {
        type: 'array',
        description: 'An array of action names (e.g., createFile, updateFile) to be performed.',
        items: {
          type: 'string',
          enum: getOperationDefs().map((op) => op.name),
        },
      },
      summary: {
        type: 'string',
        description: 'A user-facing summary of the proposed actions, asking for confirmation.',
      },
    },
    required: ['actionNames', 'summary'],
  },
};

export const handleCompoundAction: ActionHandler = async ({
  askQuestionCall,
  options,
  generateContentFn,
  prompt,
}: ActionHandlerProps): Promise<ActionResult> => {
  let actionNames: string[] = [];
  let summary = '';
  let initialInferenceCall:
    | FunctionCall<{
        actionNames: string[];
        summary: string;
      }>
    | undefined;

  // Step 1: Infer High-Level Plan (Action Types and Summary)
  try {
    putSystemMessage('Inferring high-level plan for compound action...');
    const initialInferencePrompt: PromptItem[] = [
      ...prompt,
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: `Based on the conversation history and my last message, please identify the sequence of file operations (like ${getOperationDefs()
          .map((op) => op.name)
          .join(
            ', ',
          )}) needed to fulfill my request. Provide an array of action names and a concise summary message for my confirmation. Use the "${inferActionTypesAndSummaryDef.name}" function to return this information.`,
      },
    ];

    const initialResult = await generateContentFn(
      initialInferencePrompt,
      {
        modelType: ModelType.DEFAULT, // Use a capable model for planning
        functionDefs: [...getFunctionDefs(), inferActionTypesAndSummaryDef],
        requiredFunctionName: inferActionTypesAndSummaryDef.name,
        temperature: 0.2,
        expectedResponseType: { text: false, functionCall: true, media: false },
      },
      options,
    );

    initialInferenceCall = initialResult.find((part) => part.type === 'functionCall')?.functionCall as FunctionCall<{
      actionNames: string[];
      summary: string;
    }>;

    if (!initialInferenceCall?.args?.actionNames || initialInferenceCall.args.actionNames.length === 0) {
      putSystemMessage('AI failed to generate a list of action types or returned an empty list. Cannot proceed.');
      prompt.push({
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      });
      prompt.push({
        type: 'user',
        text: 'I was unable to determine the necessary actions. Could you please clarify your request or try rephrasing it?',
      });
      return { breakLoop: false, items: [] };
    }
    actionNames = initialInferenceCall.args.actionNames;
    summary = initialInferenceCall.args.summary;
    putSystemMessage(`Inferred action types`, { actionNames, summary });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    putSystemMessage(`Error during high-level plan inference: ${errorMessage}`);
    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: `I encountered an error while planning the actions: ${errorMessage}. Please clarify your request.`,
      },
    );
    return { breakLoop: false, items: [] };
  }

  prompt.push({
    type: 'assistant',
    text: askQuestionCall.args?.message ?? '',
    functionCalls: initialInferenceCall ? [initialInferenceCall] : [],
  });

  // Step 2: Infer Parameters for Each Action
  const detailedActions: CompoundActionItem[] = [];
  let parameterInferenceFailed = false;

  for (const actionName of actionNames) {
    const currentOperationDef = getOperationDefs().find((op) => op.name === actionName);
    if (!currentOperationDef) {
      putSystemMessage(`Error: Operation definition not found for action "${actionName}". Skipping this action.`);
      // Potentially mark as failure or decide to continue with other actions
      parameterInferenceFailed = true; // Or a more nuanced error handling
      break;
    }

    try {
      putSystemMessage(`Inferring parameters for action: ${actionName}...`);
      const paramInferencePrompt: PromptItem[] = [
        ...prompt, // Includes the initial inference call and its response
        {
          type: 'user',
          text: `Now, for the action "${actionName}", please determine the specific parameters required. Refer to its definition: ${JSON.stringify(currentOperationDef.parameters)}. Use the "${actionName}" function to return these parameters.`,
        },
      ];

      const paramResult = await generateContentFn(
        paramInferencePrompt,
        {
          modelType: ModelType.DEFAULT, // Use a capable model for parameter filling
          functionDefs: [...getFunctionDefs(), inferActionTypesAndSummaryDef, currentOperationDef],
          requiredFunctionName: actionName,
          temperature: 0.1, // Low temperature for precise parameter generation
          expectedResponseType: { text: false, functionCall: true, media: false },
        },
        options,
      );

      const paramFunctionCall = paramResult.find((part) => part.type === 'functionCall')?.functionCall;

      if (!paramFunctionCall?.args) {
        putSystemMessage(`AI failed to generate parameters for action "${actionName}".`);
        parameterInferenceFailed = true;
        break;
      }

      detailedActions.push({ name: actionName, args: paramFunctionCall.args });
      putSystemMessage(`Inferred parameters for ${actionName}`, { ...paramFunctionCall });

      // Add this specific parameter inference to the prompt history
      prompt.push({
        type: 'assistant',
        functionCalls: [paramFunctionCall],
        text: `Inferring parameters for ${actionName}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      putSystemMessage(`Error inferring parameters for action "${actionName}": ${errorMessage}`);
      parameterInferenceFailed = true;
      break;
    }
  }

  if (parameterInferenceFailed) {
    const assistantMessage =
      'I was unable to determine all the necessary parameters for the requested actions. Please review the errors and try again, perhaps with more specific instructions.';
    putAssistantMessage(assistantMessage);
    prompt.push({
      type: 'assistant',
      text: assistantMessage,
    });
    prompt.push({
      type: 'user',
      text: 'Understood. I will review the errors.',
    });
    return { breakLoop: false, items: [] };
  }

  // Step 3: Consolidate and Confirm with User
  putSystemMessage('Proposed actions', { actions: detailedActions });

  const confirmation = await askUserForConfirmation(summary!, true, options, 'Yes, execute all', 'No, cancel');
  putAssistantMessage(summary!); // The summary from Step 1

  if (!confirmation.confirmed) {
    putSystemMessage('User declined compound action execution.');
    prompt.push({
      type: 'user',
      text: `User declined the proposed actions. ${confirmation.answer ?? ''}`,
    });
    return { breakLoop: false, items: [] };
  }

  // Step 4: Execute Actions
  putSystemMessage('User confirmed compound action execution. Proceeding...');
  let executionError: Error | null = null;
  let executionErrorMessage = '';

  for (const [index, action] of detailedActions.entries()) {
    putSystemMessage(`Executing action ${index + 1}/${detailedActions.length}: ${action.name}`);
    const executor = getOperationExecutor(action.name);
    if (!executor) {
      executionErrorMessage = `Error: Operation executor not found for action "${action.name}". Skipping this action.`;
      putSystemMessage(executionErrorMessage);
      // executionError = new Error(executionErrorMessage); // Decide if this is a fatal error for the batch
      // break;
      continue;
    }

    try {
      await executor(action.args, options);
      putSystemMessage(`Action ${action.name} completed successfully.`);
    } catch (error) {
      executionError = error instanceof Error ? error : new Error(String(error));
      executionErrorMessage = `Error executing action ${index + 1} (${action.name}): ${executionError.message}. Stopping batch execution.`;
      putSystemMessage(executionErrorMessage);
      break;
    }
  }

  const finalAssistantMessage = executionError
    ? `Failed to execute the batch: ${executionErrorMessage}`
    : 'Successfully executed all actions in the batch.';

  putAssistantMessage(finalAssistantMessage);

  prompt.push(
    {
      type: 'user',
      text: `User confirmed the actions. ${confirmation.answer ?? ''}`,
    },
    {
      type: 'assistant',
      text: finalAssistantMessage,
    },
    {
      type: 'user',
      text: 'Thank you. What is next?',
    },
  );

  return {
    breakLoop: false,
    items: [],
  };
};

registerActionHandler('compoundAction', handleCompoundAction);
