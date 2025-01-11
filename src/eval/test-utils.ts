import { expect } from 'vitest';
import { FunctionDef, GenerateContentFunction, PromptItem } from '../ai-service/common.js';

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
 * Helper function to validate LLM-generated content against expectations
 */
export async function validateLLMContent(
  generateContent: GenerateContentFunction,
  content: string,
  expectation: LLMContentExpectation,
  options: ValidateLLMContentOptions = {},
): Promise<boolean | string> {
  const prompt: PromptItem[] = [
    {
      type: 'systemPrompt',
      systemPrompt: `You are a test validator. Your task is to verify if the given content meets specified expectations.
Please analyze the content objectively and return a JSON object with the following structure:
{
  "valid": boolean,
  "reason": string
}`,
    },
    {
      type: 'user',
      text: `Please validate the following content against these expectations:

Content to validate:
"""
${content}
"""

Expected behavior:
${JSON.stringify(expectation, null, 2)}

Determine if the content conceptually meets ALL of the following criteria:
1. Addresses the described expectation: "${expectation.description}"
${
  expectation.requiredElements
    ? `2. Mentions all required elements/concepts: ${expectation.requiredElements.join(', ')}`
    : ''
}
${
  expectation.forbiddenElements
    ? `3. Does not contain forbidden elements: ${expectation.forbiddenElements.join(', ')}`
    : ''
}
${expectation.tone ? `4. Maintains the expected tone: ${expectation.tone}` : ''}

Full code snippets are NOT required. Conceptual descriptions and high-level instructions are acceptable.

Return a JSON object indicating if ALL criteria are met and explain your reasoning.`,
    },
  ];

  const functionDefs: FunctionDef[] = [
    {
      name: 'validateContent',
      description: 'Return validation result',
      parameters: {
        type: 'object',
        properties: {
          valid: {
            type: 'boolean',
            description: 'Whether the content meets all expectations',
          },
          reason: {
            type: 'string',
            description: 'Explanation of why the content is valid or invalid',
          },
        },
        required: ['valid', 'reason'],
      },
    },
  ];

  const result = await generateContent(
    prompt,
    functionDefs,
    'validateContent',
    options.temperature ?? 0.1,
    options.cheap ?? true,
    {},
  );

  const validation = result[0]?.args as { valid: boolean; reason: string } | undefined;

  if (!validation) {
    throw new Error('Failed to validate content - no validation result returned');
  }

  return validation.valid ? true : validation.reason;
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
