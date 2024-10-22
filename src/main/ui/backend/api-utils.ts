import { CodegenOptions } from '../../codegen-types.js';
import { getSupportedAiServices } from '../../codegen-utils.js';

// Validation function for CodegenOptions
export function validateCodegenOptions(options: CodegenOptions): string[] {
  const errors: string[] = [];

  if (typeof options.aiService !== 'string' || !getSupportedAiServices().includes(options.aiService)) {
    errors.push('Invalid aiService');
  }

  if (
    options.temperature !== undefined &&
    (typeof options.temperature !== 'number' || options.temperature < 0 || options.temperature > 2)
  ) {
    errors.push('Temperature must be a number between 0 and 2');
  }

  if (options.imagen !== undefined && !['vertex-ai', 'dall-e'].includes(options.imagen)) {
    errors.push('Invalid imagen value');
  }

  // Add more validations as needed for other fields

  return errors;
}
