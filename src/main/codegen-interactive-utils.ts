import fs from 'fs';
import { select, confirm } from '@inquirer/prompts';
import packageJson from '../../package.json' assert { type: 'json' };
import { getSourceFiles } from '../files/find-files.js';
import { CODEGEN_TRIGGER } from '../prompt/prompt-consts.js';

// Function to display the welcome message
export const displayWelcome = () => {
  console.log(`Welcome to Genaicode v${packageJson.version}`);
};

// Function to get user action
export const getUserAction = async () => {
  const action = await select({
    message: 'What would you like to do?',
    choices: [
      { name: `Process ${CODEGEN_TRIGGER} comments`, value: 'process_comments' },
      { name: 'Enter a text prompt', value: 'text_prompt' },
      { name: 'Select a task file', value: 'task_file' },
      { name: 'Exit', value: 'exit' },
    ],
  });
  return action;
};

// Function to get user options
export const getUserOptions = async () => {
  const allowFileCreate = await confirm({ message: 'Allow file creation?' });
  const allowFileDelete = await confirm({ message: 'Allow file deletion?' });
  const allowDirectoryCreate = await confirm({ message: 'Allow directory creation?' });
  const allowFileMove = await confirm({ message: 'Allow file moving?' });
  const vision = await confirm({ message: 'Enable vision capabilities?' });
  const imagen = await confirm({ message: 'Enable image generation?' });

  return {
    allowFileCreate,
    allowFileDelete,
    allowDirectoryCreate,
    allowFileMove,
    vision,
    imagen,
  };
};

// Function to check for CODEGEN comments in source files
export const checkForCodegenComments = (): boolean => {
  const sourceFiles = getSourceFiles();
  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    if (content.includes(CODEGEN_TRIGGER)) {
      return true;
    }
  }
  return false;
};
