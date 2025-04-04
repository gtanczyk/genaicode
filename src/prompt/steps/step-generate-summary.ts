import { GenerateContentFunction, GenerateContentArgs } from '../../ai-service/common-types.js';
import { PromptItem } from '../../ai-service/common-types.js';
import { ModelType } from '../../ai-service/common-types.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { getFunctionDefs } from '../function-calling.js';
import { ChatMessageFlags } from '../../main/common/content-bus-types.js';

/**
 * Prepares the prompt array for requesting a conversation summary.
 * @param prompt The current conversation prompt items.
 * @returns The augmented prompt array including the summarization request.
 */
export function prepareSummaryPrompt(prompt: PromptItem[]): PromptItem[] {
  return [
    ...prompt,
    // Add a standard assistant message before the summary request
    // to provide context that the assistant has processed the preceding user message.
    { type: 'assistant', text: 'Thank you for explaining the task.' },
    {
      type: 'user',
      text: `Provide a concise 10-word title that summarizes the main topic of this conversation.`,
    },
  ];
}

export async function executeStepGenerateSummary(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  options: CodegenOptions,
): Promise<void> {
  if (!options.conversationSummaryEnabled) {
    putSystemMessage("Not generating conversation summary because it's disabled in options.");
    return;
  }

  // Prepare the prompt using the dedicated function
  const summaryPrompt = prepareSummaryPrompt(prompt);

  const summaryRequest: GenerateContentArgs = [
    summaryPrompt,
    {
      functionDefs: getFunctionDefs(),
      requiredFunctionName: 'conversationSummary',
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

  try {
    const summaryResult = (await generateContentFn(...summaryRequest))
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall);
    const summaryExplanation = summaryResult.find((call) => call.name === 'conversationSummary');

    if (summaryExplanation && summaryExplanation.args && typeof summaryExplanation.args.title === 'string') {
      const conversationSummary = summaryExplanation.args.title;
      putSystemMessage('Generated conversation summary', conversationSummary, [ChatMessageFlags.CONVERSATION_SUMMARY]);
    } else {
      throw new Error('Failed to generate summary: unexpected response format');
    }
  } catch (error) {
    console.error('Error generating conversation summary:', error);
    putSystemMessage('Failed to generate conversation summary.');
    return;
  }
}
