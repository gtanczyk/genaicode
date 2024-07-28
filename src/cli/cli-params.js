import fs from 'fs';

const params = process.argv.slice(2);

export const dryRun = params.includes('--dry-run');
export const considerAllFiles = params.includes('--consider-all-files');
export const allowFileCreate = params.includes('--allow-file-create');
export const allowFileDelete = params.includes('--allow-file-delete');
export const allowDirectoryCreate = params.includes('--allow-directory-create');
export const allowFileMove = params.includes('--allow-file-move');
export const chatGpt = params.includes('--chat-gpt');
export const anthropic = params.includes('--anthropic');
export const vertexAi = params.includes('--vertex-ai');
export const dependencyTree = params.includes('--dependency-tree');
export const verbosePrompt = params.includes('--verbose-prompt');
export let explicitPrompt = params.find((param) => param.startsWith('--explicit-prompt'))?.split('=')[1];
export const taskFile = params.find((param) => param.startsWith('--task-file'))?.split('=')[1];
export const requireExplanations = params.includes('--require-explanations');

if (taskFile) {
  if (explicitPrompt) {
    throw new Error('The --task-file option is exclusive with the --explicit-prompt option');
  }
  if (!fs.existsSync(taskFile)) {
    throw new Error(`The task file ${taskFile} does not exist`);
  }
  explicitPrompt = `I want you to perform a coding task. The task is described in the ${taskFile} file. Use those instructions.`;
}

if (considerAllFiles && dependencyTree) {
  throw new Error('--consider-all-files and --dependency-tree are exclusive.');
}

if ([chatGpt, anthropic, vertexAi].filter(Boolean).length > 1) {
  throw new Error('--chat-gpt, --anthropic, and --vertex-ai are mutually exclusive.');
}

if (!chatGpt && !anthropic && !vertexAi) {
  throw new Error('Missing --chat-gpt, --anthropic, or --vertex-ai');
}
