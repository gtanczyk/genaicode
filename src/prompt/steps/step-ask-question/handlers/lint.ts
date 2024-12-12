import { exec } from 'child_process';
import { promisify } from 'util';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { askUserForConfirmation } from '../../../../main/common/user-actions.js';
import { rcConfig } from '../../../../main/config.js';
import { ActionHandlerProps, ActionResult, LintResult } from '../step-ask-question-types.js';

const execPromise = promisify(exec);

/**
 * Handles the lint action by executing the lint command and processing its results.
 * If the lint command fails, it will ask for user confirmation to continue with code generation.
 */
export async function handleLint({ options }: ActionHandlerProps): Promise<ActionResult> {
  if (!rcConfig.lintCommand) {
    putSystemMessage('No lint command configured. Skipping lint check.');
    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: 'No lint command configured. Skipping lint check.',
          },
          user: {
            type: 'user',
            text: 'Proceeding without lint check.',
          },
        },
      ],
    };
  }

  let lintResult: LintResult;

  try {
    putSystemMessage(`Executing lint command: ${rcConfig.lintCommand}`);
    await execPromise(rcConfig.lintCommand, { cwd: rcConfig.rootDir });
    putSystemMessage('Lint command executed successfully');

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
            text: 'Lint check passed successfully.',
          },
          user: {
            type: 'user',
            text: 'Proceeding with code generation.',
          },
        },
      ],
    };
  } catch (error) {
    const { stdout, stderr } = error as { stdout: string; stderr: string };
    putSystemMessage('Lint command failed.');

    lintResult = {
      success: false,
      stdout,
      stderr,
    };

    // In interactive or UI mode, ask user if they want to continue
    if (options.interactive || options.ui) {
      const userConfirmation = await askUserForConfirmation(
        'Lint command failed. Do you want to continue with code generation anyway?',
        false,
      );

      if (!userConfirmation.confirmed) {
        putSystemMessage(
          'Lint command failed. Aborting code generation. Please fix lint issues before running code generation, or use --disable-initial-lint',
        );
        console.log('Lint errors:', stdout, stderr);

        return {
          breakLoop: true,
          lintResult,
          items: [
            {
              assistant: {
                type: 'assistant',
                text: 'Lint check failed. Code generation aborted.',
              },
              user: {
                type: 'user',
                text: 'Fixing lint issues before proceeding.',
              },
            },
          ],
        };
      }
    } else {
      // In non-interactive mode, abort on lint failure
      putSystemMessage(
        'Lint command failed. Aborting code generation. Please fix lint issues before running code generation, or use --disable-initial-lint',
      );
      console.log('Lint errors:', stdout, stderr);

      return {
        breakLoop: true,
        lintResult,
        items: [
          {
            assistant: {
              type: 'assistant',
              text: 'Lint check failed. Code generation aborted.',
            },
            user: {
              type: 'user',
              text: 'Fixing lint issues before proceeding.',
            },
          },
        ],
      };
    }

    // User confirmed to continue despite lint errors
    return {
      breakLoop: false,
      lintResult,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: 'Lint check failed but proceeding as requested.',
          },
          user: {
            type: 'user',
            text: 'Continuing despite lint errors.',
          },
        },
      ],
    };
  }
}
