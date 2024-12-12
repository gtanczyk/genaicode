import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../../../main/common/content-bus.js';
import { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { CODEGEN_SUMMARY_PROMPT } from '../../../static-prompts.js';
import { executeStepCodegenPlanning } from '../../step-codegen-planning.js';
import { executeStepCodegenSummary } from '../../step-codegen-summary.js';
import { StepResult } from '../../steps-types.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';
import { updateFiles } from '../../../../files/update-files.js';
import { handleLint } from './lint.js';
import { rcConfig } from '../../../../main/config.js';

export async function handleCodeGeneration({
  generateContentFn,
  generateImageFn,
  waitIfPaused,
  prompt,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  // Run initial lint check if enabled
  if (!options.disableInitialLint && rcConfig.lintCommand) {
    const lintResult = await handleLint({
      generateContentFn,
      generateImageFn,
      waitIfPaused,
      prompt,
      options,
      askQuestionCall: {
        name: 'askQuestion',
        args: {
          actionType: 'lint',
          message: 'Running initial lint check',
        },
      },
    });

    if (lintResult.breakLoop) {
      return lintResult;
    }
  }

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

  putAssistantMessage('Planning phase completed. Would you like to proceed with the planned changes?');
  putUserMessage(planningConfirmation.answer || 'Accept planning and continue');

  // Add user's planning confirmation answer to prompt history
  prompt.push(
    {
      type: 'assistant',
      text: CODEGEN_SUMMARY_PROMPT,
    },
    {
      type: 'user',
      text: planningConfirmation.answer || 'Accept planning and continue',
    },
  );

  // Execute the codegen summary step
  const functionCalls = await executeStepCodegenSummary(
    generateContentFn,
    prompt,
    getFunctionDefs(),
    options,
    waitIfPaused,
    generateImageFn,
  );

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
        functionCalls.filter((call) => call.name !== 'explanation' && call.name !== 'getSourceCode'),
        options,
      );
      putSystemMessage('Code changes applied successfully');

      // Run lint after applying changes if enabled
      if (!options.disableInitialLint && rcConfig.lintCommand) {
        const postUpdateLintResult = await handleLint({
          generateContentFn,
          generateImageFn,
          waitIfPaused,
          prompt,
          options,
          askQuestionCall: {
            name: 'askQuestion',
            args: {
              actionType: 'lint',
              message: 'Running lint check after applying changes',
            },
          },
        });

        // If lint fails after applying changes, we still want to break the loop
        // but we also want to keep the changes that were applied
        if (postUpdateLintResult.breakLoop) {
          return {
            ...postUpdateLintResult,
            stepResult: functionCalls,
          };
        }
      }
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
}
