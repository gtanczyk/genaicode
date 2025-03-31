import { GenerateFunctionCallsFunction } from '../../ai-service/common-types';
import { PromptItem } from '../../ai-service/common-types';
import { FunctionDef } from '../../ai-service/common-types';
import { ModelType } from '../../ai-service/common-types';
import { LLMContentExpectation, ValidateLLMContentOptions } from './file-updates-verify';

/**
 * Helper function to validate LLM-generated content against expectations
 */

export async function validateLLMContent(
  generateContent: GenerateFunctionCallsFunction,
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
    ? `2. Mentions all required elements/concepts(or their equivalents): ${expectation.requiredElements.join(', ')}`
    : ''
}
${
  expectation.forbiddenElements
    ? `3. Does not contain forbidden elements: ${expectation.forbiddenElements.join(', ')}`
    : ''
}
${expectation.tone ? `4. Maintains the expected tone: ${expectation.tone}` : ''}
${expectation.minLength ? `5. Meets minimum length requirement: ${expectation.minLength} characters` : ''}

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
    options.cheap ? ModelType.CHEAP : ModelType.DEFAULT,
    {},
  );

  const validation = result[0]?.args as { valid: boolean; reason: string } | undefined;

  if (!validation) {
    throw new Error('Failed to validate content - no validation result returned');
  }

  return validation.valid ? true : validation.reason;
}
