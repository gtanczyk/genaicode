import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getProjectCommand } from '../../../../main/config.js';
import { ActionHandlerProps, ActionResult, LintResult } from '../step-ask-question-types.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { handleRunProjectCommand } from './handle-project-command.js';

registerActionHandler('lint', handleLint);

/**
 * Handles the lint action by executing the lint command and processing its results.
 * This is now a wrapper around the generic `runProjectCommand` handler.
 */
export async function handleLint(props: ActionHandlerProps): Promise<ActionResult> {
  const { askQuestionCall, prompt } = props;
  const lintCommand = getProjectCommand('lint');

  if (!lintCommand) {
    putSystemMessage('Lint command not configured. Skipping lint check.');

    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
        functionCalls: [{ name: 'lint', id: askQuestionCall.id + '_lint' }],
      },
      {
        type: 'user',
        text: 'Lint command not configured. Skipping lint check.',
        functionResponses: [
          {
            name: 'lint',
            call_id: askQuestionCall.id + '_lint',
            content: JSON.stringify({ error: 'Lint command not configured' }),
          },
        ],
      },
    );

    return {
      breakLoop: false,
      items: [],
    };
  }

  // Synthesize the call to the generic project command handler
  const syntheticAskQuestionCall = {
    ...askQuestionCall,
    name: 'runProjectCommand',
    args: {
      name: 'lint',
      // Pass original filePaths argument to the generic command runner
      args: (askQuestionCall.args as { filePaths?: string[] })?.filePaths,
    },
  };

  const result = await handleRunProjectCommand({ ...props, askQuestionCall: syntheticAskQuestionCall });

  const projectCommandResult = result.projectCommandResult;
  const lintResult: LintResult | undefined = projectCommandResult
    ? {
        success: projectCommandResult.success,
        stdout: projectCommandResult.stdout,
        stderr: projectCommandResult.stderr,
      }
    : undefined;

  return {
    breakLoop: false,
    lintResult,
    items: [], // The delegated handler already modified the prompt
  };
}
