import fs from 'fs';

import { serviceAutoDetect } from './service-autodetect.js';
import { rcConfig } from '../files/find-files.js';

const params = process.argv.slice(2);

export const dryRun = params.includes('--dry-run');
export const considerAllFiles = params.includes('--consider-all-files');
export const allowFileCreate = params.includes('--allow-file-create');
export const allowFileDelete = params.includes('--allow-file-delete');
export const allowDirectoryCreate = params.includes('--allow-directory-create');
export const allowFileMove = params.includes('--allow-file-move');
export let vertexAi = params.includes('--vertex-ai');
export let vertexAiClaude = params.includes('--vertex-ai-claude');
export const dependencyTree = params.includes('--dependency-tree');
export const verbosePrompt = params.includes('--verbose-prompt');
export let explicitPrompt = params.find((param) => param.startsWith('--explicit-prompt'))?.split('=')[1];
export const disableContextOptimization = params.includes('--disable-context-optimization');
export const taskFile = params.find((param) => param.startsWith('--task-file'))?.split('=')[1];
export const requireExplanations = params.includes('--require-explanations');
export const geminiBlockNone = params.includes('--gemini-block-none');
export const disableInitialLint = params.includes('--disable-initial-lint');

// Add support for --help option
export const helpRequested = params.includes('--help');

// Export the lintCommand from rcConfig
export const lintCommand = rcConfig.lintCommand || null;

// Temperature parameter
export const temperature = parseFloat(
  params.find((param) => param.startsWith('--temperature='))?.split('=')[1] || '0.7',
); // Default temperature value: 0.7

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

if ([vertexAi, vertexAiClaude].filter(Boolean).length > 1) {
  throw new Error('--vertex-ai and --vertex-ai-claude are mutually exclusive.');
}

if (!vertexAi && !vertexAiClaude && !helpRequested) {
  const detected = serviceAutoDetect();
  if (detected === 'vertex-ai') {
    console.log('Autodetected --vertex-ai');
    vertexAi = true;
  } else {
    throw new Error('Missing --vertex-ai or --vertex-ai-claude');
  }
}

if (lintCommand) {
  console.log(`Lint command detected: ${lintCommand}`);
}

if (temperature) {
  console.log(`Temperature value: ${temperature}`);
}
