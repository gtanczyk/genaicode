import { GenerateContentFunction, GenerateContentArgs, PromptItem } from '../../ai-service/common';
import { readCache, writeCache } from '../../files/cache-file';
import { CodegenOptions } from '../../main/codegen-types';
import { putSystemMessage } from '../../main/common/content-bus';
import { functionDefs } from '../function-calling';
import { StepResult } from './steps-types';
import { validateAndRecoverSingleResult } from './step-validate-recover';

export async function executeStepHistoryUpdate(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  options: CodegenOptions,
): Promise<StepResult> {
  const currentHistory = getCurrentHistory();

  const optimizationPrompt: PromptItem[] = [
    ...prompt,
    {
      type: 'assistant',
      text: 'There you go, code generation is complete. Can I update my history?',
    },
    {
      type: 'user',
      text: `Yes, please update your history.

- The current date: **${new Date().toISOString()}**.
- **Limits**:
    - Up to 250 words for the conversation summary.
    - Up to 500 words for the new history.
- **Compression Priority**: Include as much key information as possible, even if readability and style are sacrificed.
- **Content**: Combine crucial information from your current history and our recent conversation.
- **Output**: Use the function call \`updateHistory\` with \`recentConversationSummary\` and \`newHistoryContent\`.

**Instructions**:

1. **Compress Aggressively**: Use abbreviations, remove unnecessary words, and focus on key terms and facts.
2. **Retain All Key Points**: Ensure no important information from the current history or conversation is omitted.
3. **Ignore Readability**: It's acceptable if the result is less readable, as long as it contains more information.
4. **Use Compact Formats**: Consider lists, bullet points, or other formats that allow for dense information packing.
5. **Write for LLM**: Human will not be reading the history content directly, it must be useful for LLM.
      
**Current history**:
\`\`\`
${currentHistory}
\`\`\`
`,
    },
  ];

  const request: GenerateContentArgs = [optimizationPrompt, functionDefs, 'updateHistory', 1, true, options];
  let result = await generateContentFn(...request);
  result = await validateAndRecoverSingleResult(request, result, generateContentFn);
  const { newHistoryContent, recentConversationSummary } =
    result.find((call) => call.name === 'updateHistory')?.args ?? {};
  if (newHistoryContent) {
    putSystemMessage('History updated', { newHistoryContent, recentConversationSummary });
    writeCache('history', newHistoryContent);
  }

  return StepResult.CONTINUE;
}

export function getCurrentHistory() {
  return readCache('history', 'The user just started using GenAIcode for their project.');
}