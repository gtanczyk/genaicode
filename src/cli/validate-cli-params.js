// List of allowed CLI parameters
const allowedParameters = [
  '--dry-run',
  '--consider-all-files',
  '--allow-file-create',
  '--allow-file-delete',
  '--allow-directory-create',
  '--allow-file-move',
  '--chat-gpt',
  '--vertex-ai',
  '--vertex-ai-claude',
  '--anthropic',
  '--explicit-prompt=',
  '--task-file=',
  '--dependency-tree',
  '--verbose-prompt',
  '--require-explanations',
  '--disable-context-optimization',
  '--gemini-block-none',
  '--disable-initial-lint',
  '--temperature=',
  '--help',
];

/**
 * Validate CLI parameters according to those mentioned in README.md
 * Fail the process if not valid, or if an unknown parameter is passed
 * @throws {Error} If an invalid parameter is provided
 */
export function validateCliParams() {
  const providedParameters = process.argv.slice(2);

  // Check if --help is present
  const helpRequested = providedParameters.includes('--help');

  if (helpRequested) {
    // If --help is present, no other parameters should be allowed
    if (providedParameters.length > 1) {
      console.error('The --help option cannot be used with other parameters.');
      process.exit(1);
    }
    return; // Exit the function early as no further validation is needed
  }

  providedParameters.forEach((param) => {
    if (!param.startsWith('--')) {
      console.error(`Invalid parameter: ${param}, all parameters must start with --`);
      process.exit(1);
    }
    if (!allowedParameters.some((p) => (p.endsWith('=') && param.startsWith(p)) || param === p)) {
      console.error(`Invalid parameter: ${param}, allowed parameters are: ${allowedParameters.join(', ')}`);
      process.exit(1);
    }
  });

  // Validate temperature parameter, it must be a number between 0.0 and 2.0
  const temperatureParam = providedParameters.find((param) => param.startsWith('--temperature='));
  if (temperatureParam) {
    const temperatureValue = parseFloat(temperatureParam.split('=')[1]);
    if (isNaN(temperatureValue) || temperatureValue < 0.0 || temperatureValue > 2.0) {
      console.error('Invalid temperature value. It must be a number between 0.0 and 2.0.');
      process.exit(1);
    }
  }
}

/**
 * Get the value of a CLI parameter
 * @param {string} paramName - The name of the parameter to get the value for
 * @returns {string|null} The value of the parameter, or null if not found
 */
export function getCliParamValue(paramName) {
  const param = process.argv.find((arg) => arg.startsWith(`${paramName}=`));
  return param ? param.split('=')[1] : null;
}

/**
 * Check if a CLI parameter is present
 * @param {string} paramName - The name of the parameter to check
 * @returns {boolean} True if the parameter is present, false otherwise
 */
export function hasCliParam(paramName) {
  return process.argv.includes(paramName) || !!getCliParamValue(paramName);
}
