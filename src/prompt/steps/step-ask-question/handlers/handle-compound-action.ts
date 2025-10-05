import { FunctionCall, ModelType, PromptItem, FunctionDef } from '../../../../ai-service/common-types.js';
import { ActionHandler, ActionResult, ActionHandlerProps, CompoundActionItem } from '../step-ask-question-types.js';
import { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';
import { getOperationExecutor, getOperationDefs } from '../../../../operations/operations-index.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { getCompoundActionDef } from '../../../function-defs/compound-action.js';
import { executeStepEnsureContext } from '../../step-ensure-context.js';
import { StepResult } from '../../steps-types.js';
import { getSourceCode } from '../../../../files/read-files.js';
import { executeStepVerifyPatch } from '../../step-verify-patch.js';

/**
 * Constructs the prompt for the initial planning phase of a compound action.
 * @param basePrompt The current conversation history.
 * @param assistantMessage The assistant's message initiating the compound action.
 * @param compoundActionDef The function definition for the compound action planner.
 * @returns The prompt items for the planning phase.
 */
export function constructCompoundActionPlanningPrompt(
  basePrompt: PromptItem[],
  assistantMessage: string | undefined,
  compoundActionDef: FunctionDef,
): PromptItem[] {
  return [
    ...basePrompt,
    {
      type: 'assistant',
      text: assistantMessage ?? '',
    },
    {
      type: 'user',
      text: `Based on the conversation history and my last message, please identify the sequence of file operations (like ${getOperationDefs()
        .map((op) => op.name)
        .join(
          ', ',
        )}). For each operation, specify the target 'filePath' where applicable. Provide an array of actions and a concise summary message for my confirmation. Please provide information about dependency between actions. Use the "${
        compoundActionDef.name
      }" function to return this information.`,
    },
  ];
}

/**
 * Constructs the prompt for inferring parameters for a specific action within a compound action.
 * @param basePrompt The current conversation history (which includes prior planning and parameter inferences).
 * @param actionId The unique ID of the current action.
 * @param actionName The name of the current action (e.g., "createFile").
 * @param operationDef The function definition for the current action.
 * @returns The prompt items for the parameter inference phase.
 */
export function constructCompoundActionParameterInferencePrompt(
  basePrompt: PromptItem[],
  actionId: string,
  actionName: string,
  operationDef: FunctionDef,
): PromptItem[] {
  return [
    ...basePrompt,
    {
      type: 'user',
      text: `Now, for the action "${actionId}:${actionName}", please determine the specific parameters required. Refer to its definition: ${JSON.stringify(
        operationDef.parameters,
      )}. Use the "${actionName}" function to return these parameters.`,
    },
  ];
}

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
    filePath?: string;
    dependsOn?: string[];
  }> = [];
  let summary = '';
  let initialInferenceCall:
    | FunctionCall<{
        actions: Array<{
          id: string;
          name: string;
          filePath?: string;
          dependsOn?: string[];
        }>;
        summary: string;
      }>
    | undefined;

  // Step 1: Infer High-Level Plan (Action Types and Summary)
  try {
    putSystemMessage('Inferring high-level plan for compound action...');
    const initialInferencePrompt = constructCompoundActionPlanningPrompt(
      prompt,
      askQuestionCall.args?.message,
      compoundActionDef,
    );

    const initialResult = await generateContentFn(
      initialInferencePrompt,
      {
        modelType: ModelType.CHEAP, // Use a capable model for planning
        functionDefs: getFunctionDefs(), // getFunctionDefs() already includes compoundActionDef
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
        filePath?: string;
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

  prompt.push({
    type: 'assistant',
    text: askQuestionCall.args?.message ?? '', // This is the original assistant message that triggered compound action
    functionCalls: [initialInferenceCall], // The AI call for planning
  });

  putAssistantMessage(summary!);

  // prompt user for confirmation of the inferred actions
  let confirmation = await askUserForConfirmationWithAnswer(
    '',
    'Yes, proceed with these actions',
    'No, I want to change something',
    true,
    options,
  );

  if (confirmation.answer) {
    putUserMessage(confirmation.answer!);
  }

  if (!confirmation.confirmed) {
    putSystemMessage('User declined the proposed actions.');
    prompt.push({
      type: 'user',
      text: `Declining the proposed actions. ${confirmation.answer ?? ''}`,
      functionResponses: [
        {
          name: initialInferenceCall.name,
          call_id: initialInferenceCall.id,
          content: '',
        },
      ],
    });
    return { breakLoop: false, items: [] };
  }
  putSystemMessage('User confirmed the proposed actions. Proceeding with parameter inference...');

  // Ensure context for all planned files
  const uniqueFilePaths = Array.from(new Set(actions.map((a) => a.filePath).filter((p): p is string => !!p)));
  if (uniqueFilePaths.length > 0) {
    const contextAssuranceCall: FunctionCall = {
      name: 'contextAssurance',
      args: { filePaths: uniqueFilePaths },
    };
    const contextResult = await executeStepEnsureContext(prompt, contextAssuranceCall, options);
    if (contextResult === StepResult.BREAK) {
      putSystemMessage('Error: Context ensuring failed during compound action. Aborting.');
      return { breakLoop: false, items: [] };
    }
  }

  // Add initial planning call to conversation history
  prompt.push(
    {
      type: 'user', // User function response for the planning call (empty content as it was a planning step)
      text: `Accepting the proposed actions. ${confirmation.answer ?? ''}`,
      functionResponses: [
        {
          name: initialInferenceCall.name,
          call_id: initialInferenceCall.id,
          content: '',
        },
      ],
    },
    // Assistant message indicating planning is done, before parameter inference starts
    {
      type: 'assistant',
      text: `I have inferred the actions and I am ready to determine their parameters.`,
    },
  );

  // Step 2: Infer Parameters for Each Action
  const detailedActions: CompoundActionItem[] = [];
  let parameterInferenceFailed = false;
  const completedActionIds = new Set<string>();
  let actionsToInfer = [...actions]; // Create a mutable copy

  while (actionsToInfer.length > 0) {
    const processableActions = actionsToInfer.filter(
      (action) => !action.dependsOn || action.dependsOn.every((dep) => completedActionIds.has(dep)),
    );

    if (processableActions.length === 0 && actionsToInfer.length > 0) {
      putSystemMessage('Error: Circular dependency or unresolvable dependencies in compound actions.');
      parameterInferenceFailed = true;
      break;
    }
    if (processableActions.length === 0) break; // All done or stuck

    const results = await Promise.allSettled(
      processableActions.map(async (actionToProcess) => {
        const { id: actionId, name: actionName, filePath } = actionToProcess;
        const currentOperationDef = getOperationDefs().find((op) => op.name === actionName);

        if (!currentOperationDef) {
          putSystemMessage(
            `Error: Operation definition not found for action "${actionId}:${actionName}". Skipping this action.`,
          );
          parameterInferenceFailed = true;
          return { success: false, actionId };
        }

        try {
          putSystemMessage(`Inferring parameters for action: ${actionId}:${actionName}...`);
          const paramInferencePrompt = constructCompoundActionParameterInferencePrompt(
            prompt, // Pass the *current* prompt history
            actionId,
            actionName,
            currentOperationDef,
          );

          const paramResult = await generateContentFn(
            paramInferencePrompt,
            {
              modelType: ModelType.DEFAULT,
              functionDefs: getFunctionDefs(), // getFunctionDefs() includes all operation defs
              requiredFunctionName: actionName,
              temperature: 0.1,
              expectedResponseType: { text: false, functionCall: true, media: false },
            },
            options,
          );

          let paramFunctionCall = paramResult.find((part) => part.type === 'functionCall')?.functionCall;

          if (!paramFunctionCall?.args) {
            putSystemMessage(`AI failed to generate parameters for action "${actionId}:${actionName}".`);
            parameterInferenceFailed = true;
            return { success: false, actionId };
          }

          if (actionName === 'patchFile') {
            paramFunctionCall = await executeStepVerifyPatch(
              paramFunctionCall.args as { filePath: string; patch: string; explanation: string },
              generateContentFn,
              prompt,
              getFunctionDefs(),
              options.temperature!,
              false,
              options,
            );

            if (!paramFunctionCall || !paramFunctionCall.args) {
              putSystemMessage(`Error verifying patch for action "${actionId}:${actionName}".`);
              parameterInferenceFailed = true;
              return { success: false, actionId };
            }
          }

          if (filePath) {
            const fileSource = getSourceCode({ filterPaths: [filePath], forceAll: true }, options)[filePath];
            if (fileSource && 'content' in fileSource) {
              paramFunctionCall.args.oldContent = fileSource.content;
            }
          }

          detailedActions.push({ name: actionName, args: paramFunctionCall.args });
          putSystemMessage(`Inferred parameters for ${actionId}:${actionName}`, { ...paramFunctionCall });

          // Add this specific parameter inference to the prompt history for subsequent inferences
          prompt.push(
            {
              type: 'assistant',
              text: `Inferring parameters for ${actionId}:${actionName}.`, // Short text for assistant turn
              functionCalls: [paramFunctionCall],
            },
            {
              type: 'user',
              functionResponses: [
                {
                  name: paramFunctionCall.name,
                  call_id: paramFunctionCall.id,
                  content: '', // Empty content for the function response
                },
              ],
            },
          );
          completedActionIds.add(actionId);
          return { success: true, actionId };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          putSystemMessage(`Error inferring parameters for action "${actionName}": ${errorMessage}`);
          parameterInferenceFailed = true;
          return { success: false, actionId };
        }
      }),
    );

    // Filter out processed actions from actionsToInfer
    actionsToInfer = actionsToInfer.filter((action) => !processableActions.find((pa) => pa.id === action.id));

    if (
      results.some((result) => result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.success))
    ) {
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
    // No user response needed here, assistant states the failure.
    return { breakLoop: false, items: [] };
  }

  // Step 3: Consolidate and Confirm with User
  putSystemMessage('Proposed actions', { actions: detailedActions });

  confirmation = await askUserForConfirmationWithAnswer(
    'Code changes are generated, now what?',
    'Apply code changes',
    'Reject code changes',
    true,
    options,
  );

  if (confirmation.answer) {
    putUserMessage(confirmation.answer!);
  }

  if (!confirmation.confirmed) {
    putSystemMessage('User declined code changes.');
    prompt.push({
      type: 'user',
      text: `Rejecting proposed code changes. ${confirmation.answer ?? ''}`,
    });
    return { breakLoop: false, items: [] };
  }

  // Step 4: Execute Actions
  putSystemMessage('User accepted code changes. Applying...');
  let executionError: Error | null = null;
  let executionErrorMessage = '';

  prompt.push({
    type: 'user', // User confirms the plan
    text: `Applying code changes. ${confirmation.answer ?? 'Yes'}`,
  });

  for (const [index, action] of detailedActions.entries()) {
    putSystemMessage(`Executing action ${index + 1}/${detailedActions.length}: ${action.name}`);
    const executor = getOperationExecutor(action.name);
    if (!executor) {
      executionErrorMessage = `Error: Operation executor not found for action "${action.name}". Skipping this action.`;
      putSystemMessage(executionErrorMessage);
      continue;
    }

    try {
      await executor(action.args, options);
      putSystemMessage(`Action ${action.name} completed successfully.`);
    } catch (error) {
      executionError = error instanceof Error ? error : new Error(String(error));
      executionErrorMessage = `Error executing action ${index + 1} (${action.name}): ${
        executionError.message
      }. Stopping batch execution.`;
      putSystemMessage(executionErrorMessage);
    }
  }

  const finalAssistantMessage = executionError
    ? `Failed to execute the batch: ${executionErrorMessage}`
    : 'Successfully executed all actions in the batch.';

  putAssistantMessage(finalAssistantMessage);

  prompt.push({
    type: 'assistant',
    text: finalAssistantMessage,
  });
  // No final user "Thank you" here, as it would be a new turn.

  return {
    breakLoop: false,
    items: [],
  };
};

registerActionHandler('compoundAction', handleCompoundAction);
