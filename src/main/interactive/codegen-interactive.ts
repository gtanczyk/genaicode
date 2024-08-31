import { displayWelcome, getUserAction } from './common.js';
import { runProcessComments } from './process-comments.js';
import { runTextPrompt } from './text-prompt.js';
import { runTaskFile } from './task-file.js';
import { selectAiService } from './select-ai-service.js';
import { getUserOptions } from './configure.js';
import { printHelpMessage } from '../../cli/cli-options.js';
import { CodegenOptions } from '../codegen-types.js';

// Main function for interactive mode
export const runInteractiveMode = async (options: CodegenOptions) => {
  displayWelcome();

  const runNext = true;
  while (runNext) {
    const action = await getUserAction();

    if (action === 'exit') {
      console.log('Exiting Genaicode Interactive Mode. Goodbye!');
      break;
    }

    switch (action) {
      case 'process_comments':
        await runProcessComments(options);
        break;
      case 'text_prompt':
        await runTextPrompt(options);
        break;
      case 'task_file':
        await runTaskFile(options);
        break;
      case 'select_ai_service':
        options.aiService = await selectAiService(options.aiService);
        console.log(`Selected AI service: ${options.aiService}`);
        break;
      case 'configure':
        options = await getUserOptions(options);
        break;
      case 'help':
        printHelpMessage();
        break;
    }

    console.log('Task completed. Returning to main menu...\n');
  }
};
