import fs from 'fs';
import path from 'path';
import { serviceAutoDetect } from './service-autodetect.js';
import { rcConfig } from '../main/config.js';

const params = process.argv.slice(2);

export const dryRun = params.includes('--dry-run');
export const considerAllFiles = params.includes('--consider-all-files');
export const allowFileCreate = params.includes('--allow-file-create');
export const allowFileDelete = params.includes('--allow-file-delete');
export const allowDirectoryCreate = params.includes('--allow-directory-create');
export const allowFileMove = params.includes('--allow-file-move');
export let chatGpt = params.includes('--chat-gpt');
export let anthropic = params.includes('--anthropic');
export let vertexAi = params.includes('--vertex-ai');
export const vertexAiClaude = params.includes('--vertex-ai-claude');
export const dependencyTree = params.includes('--dependency-tree');
export const verbosePrompt = params.includes('--verbose-prompt');
export const disableCache = params.includes('--disable-cache');
export let explicitPrompt = params.find((param) => param.startsWith('--explicit-prompt'))?.split('=')[1];
export const disableContextOptimization = params.includes('--disable-context-optimization');
export let taskFile = params.find((param) => param.startsWith('--task-file'))?.split('=')[1];
export const requireExplanations = params.includes('--require-explanations');
export const geminiBlockNone = params.includes('--gemini-block-none');
export const disableInitialLint = params.includes('--disable-initial-lint');
export const vision = params.includes('--vision');
export const imagen = params.find((param) => param.startsWith('--imagen'))?.split('=')[1];
export const cheap = params.includes('--cheap');
export const askQuestion = params.includes('--ask-question');

// Add support for --help option
export const helpRequested = params.includes('--help');

// Export the lintCommand from rcConfig
export const lintCommand = rcConfig.lintCommand || null;

// Temperature parameter
export const temperature = parseFloat(
  params.find((param) => param.startsWith('--temperature='))?.split('=')[1] || '0.7',
); // Default temperature value: 0.7

// New content mask parameter
export const contentMask = params.find((param) => param.startsWith('--content-mask='))?.split('=')[1] || null;

// New ignore pattern parameter
export const ignorePatterns = params
  .filter((param) => param.startsWith('--ignore-pattern='))
  .map((param) => param.split('=')[1]);

if (taskFile) {
  if (explicitPrompt) {
    throw new Error('The --task-file option is exclusive with the --explicit-prompt option');
  }
  if (!fs.existsSync(taskFile)) {
    throw new Error(`The task file ${taskFile} does not exist`);
  }
  if (!path.isAbsolute(taskFile)) {
    taskFile = path.join(process.cwd(), taskFile);
  }
  explicitPrompt = `I want you to perform a coding task. The task is described in the ${taskFile} file. Use those instructions.`;
}

if (considerAllFiles && dependencyTree) {
  throw new Error('--consider-all-files and --dependency-tree are exclusive.');
}

if ([chatGpt, anthropic, vertexAi, vertexAiClaude].filter(Boolean).length > 1) {
  throw new Error('--chat-gpt, --anthropic, --vertex-ai, and --vertex-ai-claude are mutually exclusive.');
}

if (!chatGpt && !anthropic && !vertexAi && !vertexAiClaude && !helpRequested) {
  const detected = serviceAutoDetect();
  if (detected === 'anthropic') {
    console.log('Autodetected --anthropic');
    anthropic = true;
  } else if (detected === 'chat-gpt') {
    console.log('Autodetected --chat-gpt');
    chatGpt = true;
  } else if (detected === 'vertex-ai') {
    console.log('Autodetected --vertex-ai');
    vertexAi = true;
  } else {
    throw new Error('Missing --chat-gpt, --anthropic, --vertex-ai, or --vertex-ai-claude');
  }
}

if (lintCommand) {
  console.log(`Lint command detected: ${lintCommand}`);
}

if (temperature) {
  console.log(`Temperature value: ${temperature}`);
}

if (imagen) {
  console.log('Image generation functionality enabled');
}

if (cheap) {
  console.log('Cheaper AI models will be used for content and image generation');
}

if (contentMask) {
  console.log(`Content mask: ${contentMask}`);
}

if (ignorePatterns.length > 0) {
  console.log(`Ignore pattern: ${ignorePatterns.join(', ')}`);
}

if (askQuestion) {
  console.log('Assistant can ask questions to the user');
}