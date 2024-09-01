import { displayWelcome, getUserAction, UserAction } from './common.js';
import { runTextPrompt } from './text-prompt.js';
import { runTaskFile } from './task-file.js';
import { selectAiService } from './select-ai-service.js';
import { getUserOptions } from './configure.js';
import { printHelpMessage } from '../../cli/cli-options.js';
import { CodegenOptions } from '../codegen-types.js';
import { runCodegenWorker } from './codegen-worker.js';

// Main function for interactive mode
export const runInteractiveMode = async (options: CodegenOptions): Promise<void> => {
  displayWelcome();

  let shouldContinue = true;
  while (shouldContinue) {
    const action = await getUserAction();

    if (action === 'exit') {
      console.log('Exiting Genaicode Interactive Mode. Goodbye!');
      shouldContinue = false;
      break;
    }

    await handleUserAction(action, options);

    if (shouldContinue) {
      console.log('Task completed or interrupted. Returning to main menu...\n');
    }
  }
};

const handleUserAction = async (action: UserAction, options: CodegenOptions): Promise<void> => {
  let prompt: string;
  let taskFile: string;

  switch (action) {
    case 'process_comments':
      await runCodegenWorker(options);
      break;
    case 'text_prompt':
      prompt = await runTextPrompt();
      await runCodegenWorker({ ...options, explicitPrompt: prompt });
      break;
    case 'task_file':
      taskFile = await runTaskFile();
      await runCodegenWorker({ ...options, taskFile });
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
  }
};
