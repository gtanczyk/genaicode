import fs from 'fs';
import path from 'path';
import { serviceAutoDetect } from './service-autodetect.js';

const params = process.argv.slice(2);

// Handle positional arguments first
const positionalArgs = params.filter((param) => !param.startsWith('--'));
const namedArgs = params.filter((param) => param.startsWith('--'));

// Process first positional argument as either explicit prompt or task file
if (positionalArgs.length > 0) {
  const firstArg = positionalArgs[0];
  const hasExplicitPrompt = namedArgs.some((arg) => arg.startsWith('--explicit-prompt='));
  const hasTaskFile = namedArgs.some((arg) => arg.startsWith('--task-file='));

  // Only process if neither explicit prompt nor task file is provided via named arguments
  if (!hasExplicitPrompt && !hasTaskFile) {
    // Check if the argument is a file that exists
    const possibleFilePath = path.isAbsolute(firstArg) ? firstArg : path.join(process.cwd(), firstArg);
    if (fs.existsSync(possibleFilePath)) {
      params.push(`--task-file=${firstArg}`);
    } else {
      params.push(`--explicit-prompt=${firstArg}`);
    }
  }
}

export const dryRun = params.includes('--dry-run');
export const allowFileCreate = !params.includes('--disallow-file-create');
export const allowFileDelete = !params.includes('--disallow-file-delete');
export const allowDirectoryCreate = !params.includes('--disallow-directory-create');
export const allowFileMove = !params.includes('--disallow-file-move');

export let aiService = params.find((param) => param.startsWith('--ai-service='))?.split('=')[1];

export const verbosePrompt = params.includes('--verbose-prompt');
export const disableCache = params.includes('--disable-cache');
export const explicitPrompt = params.find((param) => param.startsWith('--explicit-prompt'))?.split('=')[1];
export const disableContextOptimization = params.includes('--disable-context-optimization');
export let taskFile = params.find((param) => param.startsWith('--task-file'))?.split('=')[1];
export const disableExplanations = params.includes('--disable-explanations');
export const geminiBlockNone = params.includes('--gemini-block-none');
export const vision = params.includes('--vision');
export const imagen = params.find((param) => param.startsWith('--imagen'))?.split('=')[1] as
  | 'dall-e'
  | 'vertex-ai'
  | undefined;
export const cheap = params.includes('--cheap');
export const interactive = params.includes('--interactive');
export const ui = params.includes('--ui');
export const askQuestion = (interactive || ui) && !params.includes('--disable-ask-question'); // Default enabled in interactive/ui
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
export const enableVertexUnescape = params.includes('--enable-vertex-unescape');
export const disableHistory = params.includes('--disable-history');

// Validate task file and explicitPrompt exclusivity
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

// Log the UI port
if (ui) {
  console.log(`UI mode enabled on port: ${uiPort}`);
}
