import { GenerateContentArgs, GenerateContentFunction, PromptItem } from '../../ai-service/common.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { getFunctionDefs } from '../function-calling.js';
import { ChatMessageFlags } from '../../main/common/content-bus-types.js';

export async function executeStepGenerateSummary(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  options: CodegenOptions,
): Promise<void> {
  if (!options.conversationSummaryEnabled) {
    putSystemMessage("Not generating conversation summary because it's disabled in options.");
    return;
  }

  const summaryRequest: GenerateContentArgs = [
    [
      ...prompt,
      { type: 'assistant', text: 'Thank you for explaining the task.' },
      {
        type: 'user',
        text: `Now please summarize our conversation, I want maximum 1 sentence of maximum 10 words explaning the conversation.`,
      },
    ],
    getFunctionDefs(),
    'explanation',
    0.3, // Use a lower temperature for more focused summaries
    true, // Use cheap model by default for summaries
    options,
  ];

  try {
    const summaryResult = await generateContentFn(...summaryRequest);
    const summaryExplanation = summaryResult.find((call) => call.name === 'explanation');

    if (summaryExplanation && summaryExplanation.args && typeof summaryExplanation.args.text === 'string') {
      const conversationSummary = summaryExplanation.args.text;
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
