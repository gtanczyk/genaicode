import fs from 'fs';
import path from 'path';
import { serviceAutoDetect } from './service-autodetect.js';

const params = process.argv.slice(2);

export const dryRun = params.includes('--dry-run');
export const considerAllFiles = params.includes('--consider-all-files');
export const allowFileCreate = !params.includes('--disallow-file-create');
export const allowFileDelete = !params.includes('--disallow-file-delete');
export const allowDirectoryCreate = !params.includes('--disallow-directory-create');
export const allowFileMove = !params.includes('--disallow-file-move');

export let aiService = params.find((param) => param.startsWith('--ai-service='))?.split('=')[1];

export const dependencyTree = params.includes('--dependency-tree');
export const verbosePrompt = params.includes('--verbose-prompt');
export const disableCache = params.includes('--disable-cache');
export const explicitPrompt = params.find((param) => param.startsWith('--explicit-prompt'))?.split('=')[1];
export const disableContextOptimization = params.includes('--disable-context-optimization');
export let taskFile = params.find((param) => param.startsWith('--task-file'))?.split('=')[1];
export const disableExplanations = params.includes('--disable-explanations');
export const geminiBlockNone = params.includes('--gemini-block-none');
export const disableInitialLint = params.includes('--disable-initial-lint');
export const vision = params.includes('--vision');
export const imagen = params.find((param) => param.startsWith('--imagen'))?.split('=')[1] as
  | 'dall-e'
  | 'vertex-ai'
  | undefined;
export const cheap = params.includes('--cheap');
export const askQuestion = !params.includes('--disable-ask-question'); // Default enabled
export const interactive = params.includes('--interactive');
export const ui = params.includes('--ui');
export const disableSelfReflection = params.includes('--disable-self-reflection');
export const disableConversationSummary = params.includes('--disable-conversation-summary');

// Add support for --help option
export const helpRequested = params.includes('--help');

// Temperature parameter
export const temperature = parseFloat(
  params.find((param) => param.startsWith('--temperature='))?.split('=')[1] || '0.7',
); // Default temperature value: 0.7

export const contentMask = params.find((param) => param.startsWith('--content-mask='))?.split('=')[1] || undefined;

export const ignorePatterns = params
  .filter((param) => param.startsWith('--ignore-pattern='))
  .map((param) => param.split('=')[1]);

export const disableAiServiceFallback = params.includes('--disable-ai-service-fallback');
export const disableVertexUnescape = params.includes('--disable-vertex-unescape');
export const disableHistory = params.includes('--disable-history');

// New variable to store the ui-port value
export const uiPort = parseInt(params.find((param) => param.startsWith('--ui-port='))?.split('=')[1] || '1337', 10);

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
}

if (considerAllFiles && dependencyTree) {
  throw new Error('--consider-all-files and --dependency-tree are exclusive.');
}

if (!aiService && !helpRequested) {
  const detected = serviceAutoDetect();
  if (detected) {
    console.log(`Autodetected --ai-service=${detected}`);
    aiService = detected;
  } else {
    console.warn('Missing --ai-service option. Please specify which AI service should be used.');
  }
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

if (interactive && ui) {
  throw new Error('--ui and --interactive are exclusive.');
}

if (askQuestion && (interactive || ui)) {
  console.log('Assistant can ask questions to the user');
} else {
  console.log('Assistant will not ask questions to the user');
}

if (interactive) {
  console.log('Interactive mode enabled');
}

if (disableAiServiceFallback) {
  console.log('AI service fallback is disabled');
} else {
  console.log('AI service fallback is enabled (default)');
}

if (disableSelfReflection) {
  console.log('Self-reflection mechanism is disabled');
}

// Log the UI port
if (ui) {
  console.log(`UI mode enabled on port: ${uiPort}`);
}
