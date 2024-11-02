import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { CodegenOptions, ImagenType } from '../codegen-types.js';

export const getUserOptions = async (options: CodegenOptions): Promise<CodegenOptions> => {
  const updatedOptions = { ...options };

  await configureGeneralOptions(updatedOptions);
  await configureFileOperationOptions(updatedOptions);
  await configureAIModelOptions(updatedOptions);
  await configureVisionAndImageOptions(updatedOptions);
  await configureContentMaskAndIgnorePatterns(updatedOptions);

  return updatedOptions;
};

const configureGeneralOptions = async (options: CodegenOptions): Promise<void> => {
  const generalOptions = await checkbox({
    message: 'Select general options:',
    choices: [
      { name: 'Dry run', value: 'dryRun', checked: options.dryRun },
      { name: 'Verbose', value: 'verbose', checked: options.verbose },
      { name: 'Require explanations', value: 'requireExplanations', checked: options.requireExplanations },
      { name: 'Disable initial lint', value: 'disableInitialLint', checked: options.disableInitialLint },
      { name: 'Ask questions', value: 'askQuestion', checked: options.askQuestion },
      { name: 'Disable cache', value: 'disableCache', checked: options.disableCache },
    ],
  });

  options.dryRun = generalOptions.includes('dryRun');
  options.verbose = generalOptions.includes('verbose');
  options.requireExplanations = generalOptions.includes('requireExplanations');
  options.disableInitialLint = generalOptions.includes('disableInitialLint');
  options.askQuestion = generalOptions.includes('askQuestion');
  options.disableCache = generalOptions.includes('disableCache');
};

const configureFileOperationOptions = async (options: CodegenOptions): Promise<void> => {
  const fileOptions = await checkbox({
    message: 'Select file operation options:',
    choices: [
      { name: 'Allow file creation', value: 'allowFileCreate', checked: options.allowFileCreate },
      { name: 'Allow file deletion', value: 'allowFileDelete', checked: options.allowFileDelete },
      { name: 'Allow directory creation', value: 'allowDirectoryCreate', checked: options.allowDirectoryCreate },
      { name: 'Allow file moving', value: 'allowFileMove', checked: options.allowFileMove },
    ],
  });

  options.allowFileCreate = fileOptions.includes('allowFileCreate');
  options.allowFileDelete = fileOptions.includes('allowFileDelete');
  options.allowDirectoryCreate = fileOptions.includes('allowDirectoryCreate');
  options.allowFileMove = fileOptions.includes('allowFileMove');
};

const configureAIModelOptions = async (options: CodegenOptions): Promise<void> => {
  options.disableContextOptimization = await confirm({
    message: 'Disable context optimization?',
    default: options.disableContextOptimization || false,
  });

  options.temperature = parseFloat(
    await input({
      message: 'Enter temperature (0.0 - 2.0):',
      default: options.temperature?.toString() || '0.7',
      validate: (value) => {
        const num = parseFloat(value);
        return (num >= 0 && num <= 2) || 'Please enter a number between 0 and 2';
      },
    }),
  );

  options.cheap = await confirm({
    message: 'Use cheaper, faster model?',
    default: options.cheap || false,
  });

  options.geminiBlockNone = await confirm({
    message: 'Disable safety settings for Gemini Pro model?',
    default: options.geminiBlockNone || false,
  });
};

const configureVisionAndImageOptions = async (options: CodegenOptions): Promise<void> => {
  options.vision = await confirm({
    message: 'Enable vision capabilities?',
    default: options.vision || false,
  });

  if (await confirm({ message: 'Enable image generation?', default: !!options.imagen })) {
    options.imagen = await select<ImagenType>({
      message: 'Select image generation service:',
      choices: [
        { name: 'Vertex AI', value: 'vertex-ai' },
        { name: 'DALL-E', value: 'dall-e' },
      ],
      default: options.imagen || 'vertex-ai',
    });
  } else {
    options.imagen = undefined;
  }
};

const configureContentMaskAndIgnorePatterns = async (options: CodegenOptions): Promise<void> => {
  options.contentMask = await input({
    message: 'Enter content mask (prefix of path relative to rootDir):',
    default: options.contentMask || '',
  });

  const ignorePatterns = await input({
    message: 'Enter ignore patterns (comma-separated):',
    default: options.ignorePatterns?.join(',') || '',
  });
  options.ignorePatterns = ignorePatterns ? ignorePatterns.split(',').map((p) => p.trim()) : undefined;
};
