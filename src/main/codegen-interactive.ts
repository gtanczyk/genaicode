import { input } from '@inquirer/prompts';
import fileSelector from 'inquirer-file-selector';
import { runCodegenIteration } from './codegen.js';
import { CODEGEN_TRIGGER } from '../prompt/prompt-consts.js';
import {
  displayWelcome,
  getUserAction,
  getUserOptions,
  checkForCodegenComments,
  selectAiService,
} from './codegen-interactive-utils.js';
import { rcConfig } from './config.js';
import { CodegenOptions } from '../prompt/prompt-codegen.js';
import { printHelpMessage } from '../cli/cli-options.js';

// Main function for interactive mode
export const runInteractiveMode = async () => {
  displayWelcome();

  let options: CodegenOptions = {};

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

async function runProcessComments(options: CodegenOptions) {
  const hasCodegenComments = checkForCodegenComments();
  if (!hasCodegenComments) {
    console.warn(`Warning: No ${CODEGEN_TRIGGER} comments found in the source code.`);
  }

  console.log(`Processing ${CODEGEN_TRIGGER} comments...`);
  await runCodegenIteration({ ...options, considerAllFiles: false });
}

async function runTextPrompt(options: CodegenOptions) {
  const prompt = await input({ message: 'Enter your text prompt:' });
  console.log(`Executing prompt: ${prompt}`);
  await runCodegenIteration({ ...options, explicitPrompt: prompt });
}

async function runTaskFile(options: CodegenOptions) {
  const taskFile = await fileSelector({
    message: 'Select task file:',
    path: rcConfig.rootDir,
  });
  if (taskFile) {
    console.log(`Selected task file: ${taskFile}`);
    await runCodegenIteration({ ...options, taskFile });
  } else {
    console.log('No task file selected.');
  }
}
