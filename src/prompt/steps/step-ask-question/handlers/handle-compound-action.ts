import { FunctionCall, ModelType, PromptItem } from '../../../../ai-service/common-types.js';
import { ActionHandler, ActionResult, ActionHandlerProps, CompoundActionItem } from '../step-ask-question-types.js';
import { askUserForConfirmation } from '../../../../main/common/user-actions.js';
import { getOperationExecutor, getOperationDefs } from '../../../../operations/operations-index.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { putAssistantMessage, putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { getCompoundActionDef } from '../../../function-defs/compound-action.js';

export const handleCompoundAction: ActionHandler = async ({
  askQuestionCall,
  options,
  generateContentFn,
  prompt,
}: ActionHandlerProps): Promise<ActionResult> => {
  const compoundActionDef = getCompoundActionDef();
  let actions: Array<{
    id: string;
    name: string;
    dependsOn?: string[];
  }> = [];
  let summary = '';
  let initialInferenceCall:
    | FunctionCall<{
        actions: Array<{
          id: string;
          name: string;
          dependsOn?: string[];
        }>;
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
          )}) needed to fulfill my request. Provide an array of action names and a concise summary message for my confirmation. Use the "${compoundActionDef.name}" function to return this information.`,
      },
    ];

    const initialResult = await generateContentFn(
      initialInferencePrompt,
      {
        modelType: ModelType.DEFAULT, // Use a capable model for planning
        functionDefs: getFunctionDefs(),
        requiredFunctionName: compoundActionDef.name,
        temperature: 0.2,
        expectedResponseType: { text: false, functionCall: true, media: false },
      },
      options,
    );

    initialInferenceCall = initialResult.find((part) => part.type === 'functionCall')?.functionCall as FunctionCall<{
      actions: Array<{
        id: string;
        name: string;
        dependsOn?: string[];
      }>;
      summary: string;
    }>;

    if (!initialInferenceCall?.args?.actions || initialInferenceCall.args.actions.length === 0) {
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
    actions = initialInferenceCall.args.actions;
    summary = initialInferenceCall.args.summary;
    putSystemMessage(`Inferred actions`, { actions, summary });
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

  prompt.push(
    {
      type: 'assistant',
      text: askQuestionCall.args?.message ?? '',
      functionCalls: [initialInferenceCall],
    },
    {
      type: 'user',
      functionResponses: [
        {
          name: initialInferenceCall.name,
          call_id: initialInferenceCall.id,
          content: '',
        },
      ],
    },
    {
      type: 'assistant',
      text: `I have inferred the actions, and I'm ready to proceed with the next steps`,
    },
  );

  // Step 2: Infer Parameters for Each Action
  const detailedActions: CompoundActionItem[] = [];
  let parameterInferenceFailed = false;

  const completedActions = new Set<string>();

  while (actions.length > 0) {
    const actionsToProcess = actions.filter(
      (action) => !action.dependsOn || action.dependsOn?.every((dep) => completedActions.has(dep)),
    );
    if (!actionsToProcess.length) {
      putSystemMessage('No more actions to process or circular dependency detected. Stopping parameter inference.');
      break;
    }
    actions = actions.filter((action) => !actionsToProcess.includes(action));

    const results = await Promise.allSettled(
      actionsToProcess.map(async (action) => {
        const { id: actionId, name: actionName } = action;
        const currentOperationDef = getOperationDefs().find((op) => op.name === actionName);
        if (!currentOperationDef) {
          putSystemMessage(
            `Error: Operation definition not found for action "${actionId}:${actionName}". Skipping this action.`,
          );
          // Potentially mark as failure or decide to continue with other actions
          parameterInferenceFailed = true; // Or a more nuanced error handling
          return false;
        }

        try {
          putSystemMessage(`Inferring parameters for action: ${actionId}:${actionName}...`);
          const paramInferencePrompt: PromptItem[] = [
            ...prompt, // Includes the initial inference call and its response
            {
              type: 'user',
              text: `Now, for the action "${actionId}:${actionName}", please determine the specific parameters required. Refer to its definition: ${JSON.stringify(currentOperationDef.parameters)}. Use the "${actionName}" function to return these parameters.`,
            },
          ];

          const paramResult = await generateContentFn(
            paramInferencePrompt,
            {
              modelType: ModelType.DEFAULT, // Use a capable model for parameter filling
              functionDefs: getFunctionDefs(),
              requiredFunctionName: actionName,
              temperature: 0.1, // Low temperature for precise parameter generation
              expectedResponseType: { text: false, functionCall: true, media: false },
            },
            options,
          );

          const paramFunctionCall = paramResult.find((part) => part.type === 'functionCall')?.functionCall;

          if (!paramFunctionCall?.args) {
            putSystemMessage(`AI failed to generate parameters for action "${actionId}:${actionName}".`);
            parameterInferenceFailed = true;
            return false;
          }

          detailedActions.push({ name: actionName, args: paramFunctionCall.args });
          putSystemMessage(`Inferred parameters for ${actionId}:${actionName}`, { ...paramFunctionCall });

          // Add this specific parameter inference to the prompt history
          prompt.push(
            {
              type: 'assistant',
              functionCalls: [paramFunctionCall],
              text: `Inferring parameters for ${actionId}:${actionName}`,
            },
            {
              type: 'user',
              functionResponses: [
                {
                  name: paramFunctionCall.name,
                  call_id: paramFunctionCall.id,
                  content: '',
                },
              ],
            },
          );

          completedActions.add(actionId);
          return true;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          putSystemMessage(`Error inferring parameters for action "${actionName}": ${errorMessage}`);
          parameterInferenceFailed = true;
          return false;
        }
      }),
    );

    if (results.some((result) => result.status === 'rejected' || !result.value)) {
      putSystemMessage('Some actions failed to infer parameters. Stopping parameter inference.');
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
