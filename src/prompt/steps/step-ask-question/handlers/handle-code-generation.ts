import { putAssistantMessage, putSystemMessage, putUserMessage } from '../../../../main/common/content-bus.js';
import { askUserForConfirmation, askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { CODEGEN_SUMMARY_PROMPT } from '../../../static-prompts.js';
import { executeStepCodegenPlanning } from '../../step-codegen-planning.js';
import { generateCodegenSummary } from '../../step-generate-codegen-summary.js';
import { processFileUpdates } from '../../step-process-file-updates.js';
import { StepResult } from '../../steps-types.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';
import { updateFiles } from '../../../../files/update-files.js';
import { executeStepContextCompression } from '../../step-context-compression.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';

export const CODEGEN_SUMMARY_GENERATED_MESSAGE =
  'Codegen summary is generated. Would you like to proceed with the code changes?';

export const CODEGEN_SUMMARY_APPROVED = 'Accept codegen summary and continue';

registerActionHandler('codeGeneration', handleCodeGeneration);

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
    CODEGEN_SUMMARY_PROMPT,
    'Accept plan',
    'Reject plan',
    true,
    options,
  );

  putAssistantMessage(CODEGEN_SUMMARY_PROMPT);
  prompt.push({
    type: 'assistant',
    text: CODEGEN_SUMMARY_PROMPT,
  });

  if (!planningConfirmation.confirmed) {
    // User rejected the planning, return to conversation
    if (planningConfirmation.answer) {
      putUserMessage(planningConfirmation.answer);
    }
    putSystemMessage('Planning rejected. Returning to conversation.');

    prompt.push({
      type: 'user',
      text:
        'Planning rejected. Returning to conversation.' +
        (planningConfirmation.answer ? `\n\n${planningConfirmation.answer}` : ''),
    });

    return {
      breakLoop: false,
      items: [],
    };
  }

  if (planningConfirmation.answer) {
    putUserMessage(planningConfirmation.answer);
  }

  putSystemMessage('Planning accepted. Proceeding with code generation.');

  // Add user's planning confirmation answer to prompt history
  prompt.push({
    type: 'user',
    text: 'Accept planning and continue.' + (planningConfirmation.answer ? `\n\n${planningConfirmation.answer}` : ''),
  });

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
      CODEGEN_SUMMARY_GENERATED_MESSAGE,
      'Accept codegen summary',
      'Reject codegen summary',
      true,
      options,
    );

    if (!codegenSummaryConfirmation.confirmed) {
      // User rejected the codegen summary, return to conversation
      return {
        breakLoop: false,
        items: [
          {
            assistant: {
              type: 'assistant',
              text: CODEGEN_SUMMARY_GENERATED_MESSAGE,
            },
            user: {
              type: 'user',
              text: codegenSummaryConfirmation.answer || 'Codegen summary rejected. Returning to conversation.',
            },
          },
        ],
      };
    }

    putAssistantMessage(CODEGEN_SUMMARY_GENERATED_MESSAGE);
    putUserMessage(codegenSummaryConfirmation.answer || CODEGEN_SUMMARY_APPROVED);

    prompt.push(
      {
        type: 'assistant',
        text: CODEGEN_SUMMARY_GENERATED_MESSAGE,
      },
      {
        type: 'user',
        text: codegenSummaryConfirmation.answer || CODEGEN_SUMMARY_APPROVED,
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

    const confirmApply = await askUserForConfirmationWithAnswer(
      'Code changes are generated, now what?',
      'Apply code changes',
      'Reject code changes',
      true,
      options,
    );

    putAssistantMessage('Code changes are generated, now what?');

    if (confirmApply.confirmed) {
      if (confirmApply.answer) {
        putUserMessage(confirmApply.answer);
      }

      prompt.push(
        {
          type: 'assistant',
          text: 'Code changes are generated, now what?',
        },
        {
          type: 'user',
          text: 'Apply code changes. ' + confirmApply.answer,
        },
      );

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
    } else {
      if (confirmApply.answer) {
        putUserMessage(confirmApply.answer);
      }

      putSystemMessage('Rejecting code changes...');

      prompt.push(
        {
          type: 'assistant',
          text: 'Code changes are generated, now what?',
        },
        {
          type: 'user',
          text: 'Reject code changes. ' + confirmApply.answer,
        },
      );
    }

    if (
      !(
        await askUserForConfirmation(
          'Code generation completed, do you want to continue conversation?',
          false,
          options,
          'Continue conversation',
          'End conversation',
        )
      ).confirmed
    ) {
      return {
        breakLoop: true,
        stepResult: functionCalls,
        items: [],
      };
    }

    putSystemMessage('Continuing conversation...');
    const compressionResult = await executeStepContextCompression(generateContentFn, prompt, options);

    prompt.push(
      {
        type: 'assistant',
        text: `Code generation completed, changes ${confirmApply.confirmed ? 'were accepted and applied' : 'changes were rejected and not applied'}. Should we continue the conversation?`,
      },
      {
        type: 'user',
        text: 'Thank you for doing the code generation, now lets continue the conversation.',
      },
    );

    return {
      breakLoop: compressionResult !== StepResult.CONTINUE,
      stepResult: functionCalls,
      items: [],
    };
  } catch (error) {
    putSystemMessage(`Error during code generation: ${error instanceof Error ? error.message : 'Unknown error'}`);

    const tryAgainConfirm = await askUserForConfirmation(
      'An error occurred during code generation. Would you like to try again or continue the conversation?',
      false,
      options,
      'Try again',
      'Continue conversation',
    );

    return {
      breakLoop: !tryAgainConfirm.confirmed,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: 'An error occurred during code generation. Would you like to try again or continue the conversation?',
            functionCalls: [],
          },
          user: {
            type: 'user',
            text: tryAgainConfirm.confirmed
              ? 'Lets continue the conversation'
              : 'Error occurred during code generation.',
          },
        },
      ],
    };
  }
}
