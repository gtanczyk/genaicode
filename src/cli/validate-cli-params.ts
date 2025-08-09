import fs from 'fs';
import path from 'path';
import globRegex from 'glob-regex';
import { rcConfig } from '../main/config.js';

// List of allowed CLI parameters
const allowedParameters: string[] = [
  '--dry-run',
  '--interactive',
  '--ui',
  '--ui-port=',
  '--disallow-file-create',
  '--disallow-file-delete',
  '--disallow-directory-create',
  '--disallow-file-move',
  '--ai-service=',
  '--explicit-prompt=',
  '--task-file=',
  '--verbose-prompt',
  '--disable-explanations',
  '--disable-context-optimization',
  '--gemini-block-none',
  '--temperature=',
  '--vision',
  '--imagen=',
  '--cheap',
  '--disable-ask-question',
  '--help',
  '--content-mask=',
  '--disable-cache',
  '--ignore-pattern=',
  '--force-dist',
  '--disable-ai-service-fallback',
  '--disable-history',
  '--disable-vertex-unescape',
  '--disable-self-',
  '--disable-conversation-summary',
];

/**
 * Validate CLI parameters according to those mentioned in README.md
 * Fail the process if not valid, or if an unknown parameter is passed
 * @throws {Error} If an invalid parameter is provided
 */
export function validateCliParams(): void {
  const providedParameters: string[] = process.argv.slice(2);

  // Check if --help is present
  const helpRequested: boolean = providedParameters.includes('--help');
  const positionalArgs = providedParameters.filter((param) => !param.startsWith('--'));
  const namedArgs = providedParameters.filter((param) => param.startsWith('--'));

  if (helpRequested) {
    // If --help is present, no other parameters should be allowed
    if (providedParameters.length > 1) {
      throw new Error('Error: The --help option must be used alone.');
    }
    return; // Exit the function early as no further validation is needed
  }

  // Validate positional arguments
  if (positionalArgs.length > 1) {
    throw new Error(
      'Error: Only one positional argument is allowed. Use named parameters (--option=value) for additional options.',
    );
  }

  // Check for conflicts between positional and named arguments
  if (positionalArgs.length > 0) {
    const hasExplicitPrompt = namedArgs.some((arg) => arg.startsWith('--explicit-prompt='));
    const hasTaskFile = namedArgs.some((arg) => arg.startsWith('--task-file='));
    if (hasExplicitPrompt || hasTaskFile) {
      throw new Error(
        'Error: Cannot use positional argument with --explicit-prompt or --task-file. Choose either positional or named parameter style.',
      );
    }
  }

  // Validate named parameters
  namedArgs.forEach((param: string) => {
    if (!allowedParameters.some((p) => (p.endsWith('=') && param.startsWith(p)) || param === p)) {
      throw new Error(
        `Error: Invalid parameter "${param}". Allowed parameters are:\n  ${allowedParameters.join('\n  ')}`,
      );
    }
  });

  // Validate --ai-service parameter
  const aiServiceParam: string | undefined = providedParameters.find((param) => param.startsWith('--ai-service='));
  if (aiServiceParam) {
    const aiServiceValue: string = aiServiceParam.split('=')[1];
    if (
      !['vertex-ai', 'openai', 'anthropic', 'ai-studio', 'vertex-ai-claude', 'local-llm', 'github-models'].includes(
        aiServiceValue,
      ) &&
      !aiServiceValue.startsWith('plugin:')
    ) {
      throw new Error(`Invalid --ai-service value "${aiServiceValue}"`);
    }
  }

  // Validate temperature parameter, it must be a number between 0.0 and 2.0
  const temperatureParam: string | undefined = providedParameters.find((param) => param.startsWith('--temperature='));
  if (temperatureParam) {
    const temperatureValue: number = parseFloat(temperatureParam.split('=')[1]);
    if (isNaN(temperatureValue) || temperatureValue < 0.0 || temperatureValue > 2.0) {
      throw new Error('Invalid temperature value. It must be a number between 0.0 and 2.0.');
    }
  }

  // Validate --imagen parameter
  const imagenParam: string | undefined = providedParameters.find((param) => param.startsWith('--imagen='));
  if (imagenParam) {
    const imagenValue: string = imagenParam.split('=')[1];
    if (imagenValue !== 'vertex-ai' && imagenValue !== 'dall-e') {
      throw new Error('Invalid --imagen value. It must be either "vertex-ai" or "dall-e".');
    }
  }

  if (providedParameters.includes('--vision') && providedParameters.includes('--ai-service=vertex-ai')) {
    throw new Error('--vision and --ai-service=vertex-ai are currently not supported together.');
  }

  // Validate content mask parameter
  const contentMaskParam: string | undefined = providedParameters.find((param) => param.startsWith('--content-mask='));
  if (contentMaskParam) {
    const contentMaskValue: string = contentMaskParam.split('=')[1];
    const fullPath: string = path.join(rcConfig.rootDir, contentMaskValue);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
      throw new Error(
        `Invalid --content-mask value. The path "${contentMaskValue}" does not exist or is not a directory within the project.`,
      );
    }
  }

  // Validate ignore pattern parameter
  const ignorePatternParams: string[] = providedParameters.filter((param) => param.startsWith('--ignore-pattern='));
  if (ignorePatternParams.length > 0) {
    for (const ignorePatternParam of ignorePatternParams) {
      const ignorePatternValue: string = ignorePatternParam.split('=')[1];
      if (!ignorePatternValue) {
        throw new Error('Invalid --ignore-pattern value. The pattern cannot be empty.');
      }
      try {
        globRegex(ignorePatternValue);
      } catch (e) {
        console.error(e);
        throw new Error(`Invalid --ignore-pattern value. The pattern "${ignorePatternValue}" is not valid.`);
      }
    }
  }
}

/**
 * Get the value of a CLI parameter
 * @param {string} paramName - The name of the parameter to get the value for
 * @returns {string|null} The value of the parameter, or null if not found
 */
export function getCliParamValue(paramName: string): string | null {
  const param: string | undefined = process.argv.find((arg) => arg.startsWith(`${paramName}=`));
  return param ? param.split('=')[1] : null;
}

/**
 * Check if a CLI parameter is present
 * @param {string} paramName - The name of the parameter to check
 * @returns {boolean} True if the parameter is present, false otherwise
 */
export function hasCliParam(paramName: string): boolean {
  return process.argv.includes(paramName) || !!getCliParamValue(paramName);
}
