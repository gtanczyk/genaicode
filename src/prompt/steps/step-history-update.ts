import { GenerateContentArgs, GenerateContentFunction } from '../../ai-service/common-types.js';
import { PromptItem } from '../../ai-service/common-types.js';
import { ModelType } from '../../ai-service/common-types.js';
import { readCache, writeCache } from '../../files/cache-file.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { getFunctionDefs } from '../function-calling.js';
import { StepResult } from './steps-types.js';

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

  const request: GenerateContentArgs = [
    optimizationPrompt,
    {
      functionDefs: getFunctionDefs(),
      requiredFunctionName: 'updateHistory',
      temperature: 1,
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
    .map((item) => item.functionCall);
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
