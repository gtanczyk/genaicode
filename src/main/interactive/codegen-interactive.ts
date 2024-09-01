import { displayWelcome, getUserAction, UserAction } from './common.js';
import { runTextPrompt } from './text-prompt.js';
import { runTaskFile } from './task-file.js';
import { selectAiService } from './select-ai-service.js';
import { getUserOptions } from './configure.js';
import { printHelpMessage } from '../../cli/cli-options.js';
import { CodegenOptions } from '../codegen-types.js';
import { runProcessComments } from './process-comments.js';
import { handleError } from './error-handling.js';

// Main function for interactive mode
export const runInteractiveMode = async (options: CodegenOptions): Promise<void> => {
  displayWelcome();

  const nextRun = true;
  while (nextRun) {
    try {
      const action = await getUserAction();

      if (action === 'exit') {
        console.log('Exiting Genaicode Interactive Mode. Goodbye!');
        break;
      }

      await handleUserAction(action, options);

      console.log('Task completed. Returning to main menu...\n');
    } catch (error) {
      await handleError(error);
    }
  }
};

const handleUserAction = async (action: UserAction, options: CodegenOptions): Promise<void> => {
  switch (action) {
    case 'process_comments':
      await runProcessComments(options);
      break;
    case 'text_prompt':
      await runTextPrompt(options);
      break;
    case 'task_file':
      runTaskFile(options);
      break;
    case 'select_ai_service':
      options.aiService = await selectAiService(options.aiService);
      break;
    case 'configure':
      Object.assign(options, await getUserOptions(options));
      break;
    case 'help':
      printHelpMessage();
      break;
    case 'main_menu':
      // Do nothing, just return to main menu
      break;
    default:
      console.log('Invalid action. Returning to main menu.');
  }
};
