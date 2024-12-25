import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../../../main/common/content-bus.js';
import { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { CODEGEN_SUMMARY_PROMPT } from '../../../static-prompts.js';
import { executeStepCodegenPlanning } from '../../step-codegen-planning.js';
import { generateCodegenSummary } from '../../step-generate-codegen-summary.js';
import { processFileUpdates } from '../../step-process-file-updates.js';
import { StepResult } from '../../steps-types.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';
import { updateFiles } from '../../../../files/update-files.js';

export async function handleCodeGeneration({
  generateContentFn,
  generateImageFn,
  waitIfPaused,
  prompt,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  const planningResult = await executeStepCodegenPlanning(generateContentFn, prompt, options);
  if (planningResult === StepResult.BREAK) {
    return {
      breakLoop: true,
      items: [],
    };
  }

  // Ask user to confirm the planning result
  const planningConfirmation = await askUserForConfirmationWithAnswer(
    'Planning phase completed. Would you like to proceed with the planned changes?',
    'Accept planning and continue',
    'Reject planning and return to conversation',
    true,
  );

  if (!planningConfirmation.confirmed) {
    // User rejected the planning, return to conversation
    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: CODEGEN_SUMMARY_PROMPT,
            functionCalls: [],
          },
          user: {
            type: 'user',
            text: planningConfirmation.answer || 'Planning rejected. Returning to conversation.',
          },
        },
      ],
    };
  }

  // Add user's planning confirmation answer to prompt history
  const assistantItem = {
    type: 'assistant',
    text: CODEGEN_SUMMARY_PROMPT,
  } as const;
  putAssistantMessage(assistantItem.text, undefined, undefined, undefined, assistantItem);
  prompt.push(assistantItem);

  const userItem = {
    type: 'user',
    text: planningConfirmation.answer || 'Accept planning and continue',
  } as const;
  putUserMessage(userItem.text, undefined, undefined, undefined, userItem);
  prompt.push(userItem);

  try {
    // First step: Generate and validate codegen summary
    const { codegenSummaryRequest, baseResult } = await generateCodegenSummary(
      generateContentFn,
      prompt,
      getFunctionDefs(),
      options,
    );

    // Ask user to confirm the codegen summary
    const codegenSummaryConfirmation = await askUserForConfirmationWithAnswer(
      'Codegen summary is generated. Would you like to proceed with the code changes?',
      'Accept codegen summary and continue',
      'Reject codegen summary and return to conversation',
      true,
    );

    if (!codegenSummaryConfirmation.confirmed) {
      // User rejected the codegen summary, return to conversation
      return {
        breakLoop: false,
        items: [
          {
            assistant: {
              type: 'assistant',
              text: 'Codegen summary is generated. Would you like to proceed with the code changes?',
            },
            user: {
              type: 'user',
              text: codegenSummaryConfirmation.answer || 'Codegen summary rejected. Returning to conversation.',
            },
          },
        ],
      };
    }

    prompt.push(
      {
        type: 'assistant',
        text: 'Codegen summary is generated. Would you like to proceed with the code changes?',
      },
      {
        type: 'user',
        text: codegenSummaryConfirmation.answer || 'Accept codegen summary and continue',
      },
    );

    // Second step: Process file updates
    const updateResults = await processFileUpdates(
      generateContentFn,
      prompt,
      getFunctionDefs(),
      options,
      codegenSummaryRequest,
      waitIfPaused,
      generateImageFn,
    );

    const functionCalls = [...baseResult, ...updateResults];

    const confirmed = await askUserForConfirmationWithAnswer(
      'Code changes are generated, now what?',
      'Apply code changes',
      'Continue conversation',
      true,
    );

    if (confirmed.confirmed) {
      putSystemMessage('Applying code changes...');

      if (options.dryRun) {
        putSystemMessage('Dry run mode, not updating files');
      } else {
        // Apply the code changes
        await updateFiles(
          functionCalls.filter(
            (call) => call.name !== 'explanation' && call.name !== 'getSourceCode' && call.name !== 'codegenSummary',
          ),
          options,
        );
        putSystemMessage('Code changes applied successfully');
      }
    }

    return {
      breakLoop: confirmed.confirmed ?? true,
      stepResult: functionCalls,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: 'Code changes are generated, now what?',
          },
          user: {
            type: 'user',
            text: confirmed.answer || 'Apply code changes.',
          },
        },
      ],
    };
  } catch (error) {
    putSystemMessage(`Error during code generation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: 'An error occurred during code generation. Would you like to try again or continue the conversation?',
            functionCalls: [],
          },
          user: {
            type: 'user',
            text: 'Error occurred during code generation.',
          },
        },
      ],
    };
  }
}
