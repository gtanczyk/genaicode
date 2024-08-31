import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { CodegenOptions, ImagenType } from '../codegen-types.js';

// Function to get user options
export const getUserOptions = async (options: CodegenOptions): Promise<CodegenOptions> => {
  const updatedOptions = { ...options };

  // General options
  const generalOptions = await checkbox({
    message: 'Select general options:',
    choices: [
      { name: 'Consider all files', value: 'considerAllFiles', checked: options.considerAllFiles },
      { name: 'Dry run', value: 'dryRun', checked: options.dryRun },
      { name: 'Verbose', value: 'verbose', checked: options.verbose },
      { name: 'Require explanations', value: 'requireExplanations', checked: options.requireExplanations },
      { name: 'Disable initial lint', value: 'disableInitialLint', checked: options.disableInitialLint },
      { name: 'Ask questions', value: 'askQuestion', checked: options.askQuestion },
      { name: 'Disable cache', value: 'disableCache', checked: options.disableCache },
    ],
  });

  updatedOptions.considerAllFiles = generalOptions.includes('considerAllFiles');
  updatedOptions.dryRun = generalOptions.includes('dryRun');
  updatedOptions.verbose = generalOptions.includes('verbose');
  updatedOptions.requireExplanations = generalOptions.includes('requireExplanations');
  updatedOptions.disableInitialLint = generalOptions.includes('disableInitialLint');
  updatedOptions.askQuestion = generalOptions.includes('askQuestion');
  updatedOptions.disableCache = generalOptions.includes('disableCache');

  // File operation options
  const fileOptions = await checkbox({
    message: 'Select file operation options:',
    choices: [
      { name: 'Allow file creation', value: 'allowFileCreate', checked: options.allowFileCreate },
      { name: 'Allow file deletion', value: 'allowFileDelete', checked: options.allowFileDelete },
      { name: 'Allow directory creation', value: 'allowDirectoryCreate', checked: options.allowDirectoryCreate },
      { name: 'Allow file moving', value: 'allowFileMove', checked: options.allowFileMove },
    ],
  });

  updatedOptions.allowFileCreate = fileOptions.includes('allowFileCreate');
  updatedOptions.allowFileDelete = fileOptions.includes('allowFileDelete');
  updatedOptions.allowDirectoryCreate = fileOptions.includes('allowDirectoryCreate');
  updatedOptions.allowFileMove = fileOptions.includes('allowFileMove');

  // AI model options
  updatedOptions.disableContextOptimization = await confirm({
    message: 'Disable context optimization?',
    default: options.disableContextOptimization || false,
  });

  updatedOptions.temperature = parseFloat(
    await input({
      message: 'Enter temperature (0.0 - 2.0):',
      default: options.temperature?.toString() || '0.7',
      validate: (value) => {
        const num = parseFloat(value);
        return (num >= 0 && num <= 2) || 'Please enter a number between 0 and 2';
      },
    }),
  );

  updatedOptions.cheap = await confirm({
    message: 'Use cheaper, faster model?',
    default: options.cheap || false,
  });

  updatedOptions.geminiBlockNone = await confirm({
    message: 'Disable safety settings for Gemini Pro model?',
    default: options.geminiBlockNone || false,
  });

  // Vision and image generation options
  updatedOptions.vision = await confirm({
    message: 'Enable vision capabilities?',
    default: options.vision || false,
  });

  if (await confirm({ message: 'Enable image generation?', default: !!options.imagen })) {
    updatedOptions.imagen = await select<ImagenType>({
      message: 'Select image generation service:',
      choices: [
        { name: 'Vertex AI', value: 'vertex-ai' },
        { name: 'DALL-E', value: 'dall-e' },
      ],
      default: options.imagen || 'vertex-ai',
    });
  } else {
    updatedOptions.imagen = undefined;
  }

  // Content mask and ignore patterns
  updatedOptions.contentMask = await input({
    message: 'Enter content mask (prefix of path relative to rootDir):',
    default: options.contentMask || '',
  });

  const ignorePatterns = await input({
    message: 'Enter ignore patterns (comma-separated):',
    default: options.ignorePatterns?.join(',') || '',
  });
  updatedOptions.ignorePatterns = ignorePatterns ? ignorePatterns.split(',').map((p) => p.trim()) : undefined;

  return updatedOptions;
};
