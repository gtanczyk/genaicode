import { exec } from 'child_process';
import { promisify } from 'util';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { rcConfig } from '../../../../main/config.js';
import { ActionHandlerProps, ActionResult, LintResult } from '../step-ask-question-types.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';

const execPromise = promisify(exec);

registerActionHandler('lint', handleLint);

/**
 * Handles the lint action by executing the lint command and processing its results.
 * If the lint command fails, it will ask for user confirmation to continue with code generation.
 */
export async function handleLint({ askQuestionCall }: ActionHandlerProps): Promise<ActionResult> {
  if (!rcConfig.lintCommand) {
    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: askQuestionCall.args?.message ?? '',
            functionCalls: [{ name: 'lint', id: askQuestionCall.id + '_lint' }],
          },
          user: {
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
        },
      ],
    };
  }

  let lintResult: LintResult;

  try {
    putSystemMessage(`Executing lint command: ${rcConfig.lintCommand}`);
    await execPromise(rcConfig.lintCommand, { cwd: rcConfig.rootDir });

    lintResult = {
      success: true,
    };

    return {
      breakLoop: false,
      lintResult,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: askQuestionCall.args?.message ?? '',
            functionCalls: [{ name: 'lint', id: askQuestionCall.id + '_lint' }],
          },
          user: {
            type: 'user',
            text: 'Lint command executed successfully, no issues found.',
            functionResponses: [
              {
                name: 'lint',
                call_id: askQuestionCall.id + '_lint',
                content: JSON.stringify(lintResult),
              },
            ],
          },
        },
      ],
    };
  } catch (error) {
    const { stdout, stderr } = error as { stdout: string; stderr: string };

    lintResult = {
      success: false,
      stdout,
      stderr,
    };

    // User confirmed to continue despite lint errors
    return {
      breakLoop: false,
      lintResult,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: askQuestionCall.args?.message ?? '',
            functionCalls: [{ name: 'lint', id: askQuestionCall.id + '_lint' }],
          },
          user: {
            type: 'user',
            text: 'Lint command failed, please analyze the output.',
            data: { stdout, stderr },
            functionResponses: [
              {
                name: 'lint',
                call_id: askQuestionCall.id + '_lint',
                content: JSON.stringify(lintResult),
              },
            ],
          },
        },
      ],
    };
  }
}
