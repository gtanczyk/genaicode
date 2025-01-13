import { expect } from 'vitest';

/**
 * Expected behavior for LLM-generated content
 */
export interface LLMContentExpectation {
  /** Description of what the content should achieve or contain */
  description: string;
  /** List of required elements or concepts that should be present */
  requiredElements?: string[];
  /** List of elements or concepts that should not be present */
  forbiddenElements?: string[];
  /** Expected tone or style (e.g., 'technical', 'user-friendly') */
  tone?: string;
  /** Minimum length requirement for the content */
  minLength?: number;
}

/**
 * Options for LLM content validation
 */
export interface ValidateLLMContentOptions {
  /** Temperature for LLM validation (lower means more deterministic) */
  temperature?: number;
  /** Whether to use cheaper model for validation */
  cheap?: boolean;
}

/**
 * Helper function to verify file updates contain expected paths and tools
 */
export function verifyFileUpdates(
  fileUpdates: Array<{ filePath: string; updateToolName: string }>,
  expectedPaths: string[],
  expectedTools: string[],
): void {
  const missingPaths = expectedPaths.filter((path) => !fileUpdates.some((update) => update.filePath === path));
  const missingTools = expectedTools.filter((tool) => !fileUpdates.some((update) => update.updateToolName === tool));

  const actualPaths = fileUpdates.map((update) => update.filePath);
  const actualTools = fileUpdates.map((update) => update.updateToolName);

  // If there are any missing items, create a detailed error message
  if (missingPaths.length > 0 || missingTools.length > 0) {
    const errorParts = [];

    if (missingPaths.length > 0) {
      errorParts.push(
        'Missing expected file paths:',
        ...missingPaths.map((path) => `  - ${path}`),
        '\nActual paths:',
        ...actualPaths.map((path) => `  - ${path}`),
      );
    }

    if (missingTools.length > 0) {
      if (errorParts.length > 0) errorParts.push('\n');
      errorParts.push(
        'Missing expected update tools:',
        ...missingTools.map((tool) => `  - ${tool}`),
        '\nActual tools:',
        ...actualTools.map((tool) => `  - ${tool}`),
      );
    }

    expect.fail(errorParts.join('\n'));
  }
}

/**
 * Helper function to verify context paths
 */
export function verifyContextPaths(contextPaths: string[], expectedPaths: string[]): void {
  const missingPaths = expectedPaths.filter((path) => !contextPaths.includes(path));

  if (missingPaths.length > 0) {
    const errorMessage = [
      'Missing expected context paths:',
      ...missingPaths.map((path) => `  - ${path}`),
      '\nActual context paths:',
      ...contextPaths.map((path) => `  - ${path}`),
    ].join('\n');

    expect.fail(errorMessage);
  }
}
