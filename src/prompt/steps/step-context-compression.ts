import { GenerateContentFunction, GenerateContentArgs, PromptItem, ModelType } from '../../ai-service/common-types.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { getFunctionDefs } from '../function-calling.js';
import { StepResult } from './steps-types.js';
import { ContextCompressionCall } from '../function-defs/context-compression.js';
import { executeStepEnsureContext } from './step-ensure-context.js';

export const CONTEXT_COMPRESSION_PROMPT = `Analyze the conversation history and source code dependencies to create a comprehensive context summary that preserves essential information while maintaining reasonable token efficiency.

Key Principles:
1. Preserve Rich Context: Maintain detailed information about the conversation, especially for expensive operations like reasoning inference, code analysis, or complex decision-making.
2. Token Efficiency: Target a 50-80% reduction in tokens while preserving critical information. For example:
   - Long conversations (>50k tokens): Aim for 75-80% reduction
   - Medium conversations (10k-50k tokens): Aim for 60-75% reduction
   - Short conversations (<10k tokens): Aim for 50-60% reduction
3. File Handling: Do not include file contents in the summary - use filePaths array for this purpose.
4. Temporal Context: Preserve chronological progression of important decisions and changes.

Required Information to Preserve:

1. Conversation Flow:
   **High Priority:**
   - Initial problem statement and core requirements
   - Results of expensive operations (reasoning inference, analysis)
   - Key architectural and design decisions with rationale
   - Critical constraints or requirements
   - Major changes in direction or approach

   **Medium Priority:**
   - Important clarifying questions and answers
   - User preferences affecting implementation
   - Significant technical discussions
   - Error handling requirements

   **Optional:**
   - General feedback or observations
   - Minor clarifications
   - Non-critical issues encountered
   - Routine confirmations

2. Technical Details:
   **High Priority:**
   - Specific code changes proposed or implemented
   - Critical architectural decisions
   - Security considerations
   - Performance requirements
   - Core dependencies and their relationships

   **Medium Priority:**
   - Testing requirements
   - Code organization decisions
   - Implementation patterns chosen
   - File structure changes

   **Optional:**
   - Alternative approaches considered
   - Code style preferences
   - Non-critical optimizations
   - Documentation suggestions

3. Implementation Status:
   **High Priority:**
   - Current development stage
   - Blocking issues or challenges
   - Critical validation results
   - Required next steps

   **Medium Priority:**
   - Completed steps
   - Pending tasks
   - Test results

   **Optional:**
   - Nice-to-have features
   - Non-blocking improvements
   - Future considerations

Priority Conflict Resolution:
1. When multiple items compete for inclusion:
   - Always preserve items marked as "High Priority"
   - Include "Medium Priority" items if they directly relate to "High Priority" items
   - Include "Optional" items only if they provide crucial context for "High Priority" items
2. When facing token limits:
   - First, compress or remove "Optional" items
   - Then, selectively compress "Medium Priority" items
   - Finally, if necessary, compress (but never remove) "High Priority" items
3. When items span multiple categories:
   - Preserve items that appear in multiple "High Priority" sections
   - Combine related items to reduce redundancy while maintaining context

Deduplication Guidance:
1. Identify and remove redundant information:
   Example - Before:
   "User asked about error handling. Assistant explained error handling approach. User requested clarification about error handling. Assistant provided more details about error handling."
   After:
   "Discussion of error handling approach: Initial explanation followed by clarification of specific details."

2. Merge related technical decisions:
   Example - Before:
   "Decided to use async/await. Later discussed error handling with try/catch. Then added discussion about Promise rejection handling."
   After:
   "Implemented asynchronous operations using async/await pattern, incorporating comprehensive error handling (try/catch and Promise rejections)."

3. Combine similar requirements:
   Example - Before:
   "Need to handle network errors. Should retry failed requests. Must implement timeout for requests. Should handle offline mode."
   After:
   "Network handling requirements: Error recovery with retries, request timeouts, and offline mode support."

File Path Inclusion Criteria:
1. Always Include:
   - Files directly targeted for modification
   - Files containing code being analyzed or referenced
   - Critical dependencies of modified files
   - Configuration files affecting the changes

2. Include Based on Context:
   - Files containing relevant examples or patterns
   - Test files for affected components
   - Related documentation files

3. Do Not Include:
   - Files only mentioned in passing
   - Deprecated or unused files
   - Files from rejected approaches
   - Files outside the current task scope

Handling Complex Technical Discussions:
1. For Code Analysis:
   - Preserve detailed reasoning about algorithmic choices
   - Keep performance considerations and trade-offs
   - Maintain security-related discussions
   - Retain architectural decisions and their rationale

2. For Multi-File Dependencies:
   - Document relationships between files
   - Preserve dependency chain reasoning
   - Keep critical implementation order requirements
   - Maintain context about shared components

3. For Technical Decisions:
   - Preserve core decision points and rationale
   - Keep relevant constraints and requirements
   - Maintain important trade-off discussions
   - Retain technical debt considerations

Format your response as a structured JSON object with:
- conversationSummary: Detailed summary preserving rich context of the conversation's progression and key decisions
- filePaths: Array of file paths that are critical for the task (no file contents, just paths)

Example of good summary structure:
{
  "conversationSummary": "Started: User requested CONTEXT_COMPRESSION_PROMPT improvement. Analysis: Current compression too aggressive (100k->100 tokens). Key Decision: Allow larger summaries (5k tokens ok). Reasoning inference revealed importance of preserving expensive operation results. Implementation: Updating compression logic in step-context-compression.ts. Requirements: 1) Less aggressive compression, 2) Rich conversation preservation, 3) No file contents in summary.",
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
    const compressContextCall = await compressConversationHistory(
      generateContentFn,
      prompt.slice(initialPromptIndex, prompt.length),
      options,
    );

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
      text: 'This is summary of our conversation:\n\n' + compressContextCall.args!.conversationSummary,
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
    {
      type: 'systemPrompt',
      systemPrompt: CONTEXT_COMPRESSION_PROMPT,
    },
    ...prompt,
  ];

  const request: GenerateContentArgs = [
    summaryPrompt,
    {
      functionDefs: getFunctionDefs(),
      requiredFunctionName: 'compressContext',
      temperature: 0.3, // Use a lower temperature for more focused summaries
      modelType: ModelType.CHEAP,
      expectedResponseType: {
        text: false,
        functionCall: true,
        media: false,
      },
    },
    options,
  ];

  const result = (await generateContentFn(...request))
    .filter((item) => item.type === 'functionCall')
    .map((item) => item.functionCall) as [ContextCompressionCall];
  return result[0];
}
