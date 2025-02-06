import { GenerateContentFunction, GenerateContentArgs, PromptItem, ModelType } from '../../ai-service/common-types.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { getFunctionDefs } from '../function-calling.js';
import { StepResult } from './steps-types.js';
import { validateAndRecoverSingleResult } from './step-validate-recover.js';
import { ContextCompressionCall } from '../function-defs/context-compression.js';
import { executeStepEnsureContext } from './step-ensure-context.js';

export const CONTEXT_COMPRESSION_PROMPT = `Analyze the conversation history and source code dependencies to create a comprehensive context summary that preserves essential information while maintaining reasonable token efficiency.

Key Principles:
1. Preserve Rich Context: Maintain detailed information about the conversation, especially for expensive operations like reasoning inference, code analysis, or complex decision-making.
2. Token Efficiency: Aim for a meaningful compression (e.g., 5k tokens for a 100k token conversation) without being overly aggressive.
3. File Handling: Do not include file contents in the summary - use filePaths array for this purpose.
4. Temporal Context: Preserve chronological progression of important decisions and changes.

Required Information to Preserve:
1. Conversation Flow:
   - Initial problem statement or task
   - Key questions asked and answers received
   - Important decisions made and their rationale
   - Results of expensive operations (reasoning inference, analysis)
   - Critical user preferences or constraints
   - Any errors or issues encountered

2. Technical Details:
   - Code changes proposed or implemented
   - Architecture decisions
   - Performance considerations
   - Security implications
   - Dependencies identified
   - Testing requirements

3. Implementation Status:
   - Current stage of development
   - Completed steps
   - Pending tasks
   - Known issues or challenges
   - Validation results

Format your response as a structured JSON object with:
- conversationSummary: Detailed summary preserving rich context of the conversation's progression and key decisions
- codegenIntent: Comprehensive description of the primary goal, constraints, and special requirements
- filePaths: Array of file paths that are critical for the task (no file contents, just paths)

Example of good summary structure:
{
  "conversationSummary": "Started: User requested CONTEXT_COMPRESSION_PROMPT improvement. Analysis: Current compression too aggressive (100k->100 tokens). Key Decision: Allow larger summaries (5k tokens ok). Reasoning inference revealed importance of preserving expensive operation results. Implementation: Updating compression logic in step-context-compression.ts. Requirements: 1) Less aggressive compression, 2) Rich conversation preservation, 3) No file contents in summary.",
  "codegenIntent": "Enhance context compression to preserve more information (up to 5k tokens) while maintaining efficiency. Focus on rich conversation details, especially expensive operations like reasoning inference. Exclude file contents from summary/intent, using filePaths instead. Goal: Better balance between compression and information preservation.",
  "filePaths": ["/path/to/relevant/files"]
}

Focus on creating a summary that:
1. Is comprehensive enough for the AI to understand the full context
2. Preserves expensive computation results
3. Maintains chronological flow of decisions
4. Captures technical details and requirements
5. Excludes file contents but includes critical file paths`;

/**
 * Executes the context compression step
 */
export async function executeStepContextCompression(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  options: CodegenOptions,
): Promise<StepResult> {
  const initialPromptIndex = prompt.findIndex((item) => item.itemId === 'INITIAL_PROMPT');
  if (initialPromptIndex === -1) {
    putSystemMessage('Could not find initial prompt, something is wrong.');
    return StepResult.CONTINUE;
  }

  try {
    putSystemMessage('Context compression is starting...');
    const compressContextCall = await compressConversationHistory(generateContentFn, prompt, options);

    if (!compressContextCall) {
      putSystemMessage('Context compression did not return a result');
      return StepResult.BREAK;
    }

    // Replace the initial prompt with the context compression call response
    prompt.splice(initialPromptIndex, prompt.length - initialPromptIndex);

    // Add compression result to prompt
    prompt.push({
      type: 'user',
      itemId: 'INITIAL_PROMPT',
      text:
        'Here is summary of our conversation:\n' +
        compressContextCall.args!.codegenIntent +
        '\n\n' +
        compressContextCall.args!.conversationSummary,
    });

    // Ensure context
    await executeStepEnsureContext(prompt, compressContextCall, options);

    putSystemMessage('Context compression completed successfully.', compressContextCall.args);

    return StepResult.CONTINUE;
  } catch (error) {
    putSystemMessage('An unexpected error occurred during context compression', { error });
    return StepResult.BREAK;
  }
}

/**
 * Compresses the conversation history using the AI model
 */
async function compressConversationHistory(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  options: CodegenOptions,
): Promise<ContextCompressionCall | undefined> {
  const summaryPrompt: PromptItem[] = [
    ...prompt,
    {
      type: 'user',
      text: CONTEXT_COMPRESSION_PROMPT,
    },
  ];

  const request: GenerateContentArgs = [
    summaryPrompt,
    getFunctionDefs(),
    'compressContext',
    0.3, // Use a lower temperature for more focused summaries
    ModelType.CHEAP,
    options,
  ];

  let result = (await generateContentFn(...request)) as [ContextCompressionCall];
  result = (await validateAndRecoverSingleResult(request, result, generateContentFn)) as [ContextCompressionCall];
  return result[0];
}
