import { GenerateContentFunction, PromptItem } from '../../ai-service/common';
import { readCache, writeCache } from '../../files/cache-file';
import { CodegenOptions } from '../../main/codegen-types';
import { putSystemMessage } from '../../main/common/content-bus';
import { functionDefs } from '../function-calling';
import { StepResult } from './steps-types';

export async function executeStepIdentity(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  options: CodegenOptions,
): Promise<StepResult> {
  const currentIdentity = readCache('identity', 'The user just started using GenAIcode for their project.');

  const optimizationPrompt: PromptItem[] = [
    ...prompt,
    {
      type: 'assistant',
      text: 'There you go, code generation is complete. Can I update my identity?',
    },
    {
      type: 'user',
      text: `Yes, please update your identity.

- The current date: **${new Date().toISOString()}**.
- **Limits**:
    - Up to 75 tokens for the conversation summary.
    - Up to 150 tokens for the new identity.
- **Compression Priority**: Include as much key information as possible, even if readability and style are sacrificed.
- **Content**: Combine crucial information from your current identity and our recent conversation.
- **Output**: Use the function call \`updateIdentity\` with \`recentConversationSummary\` and \`newIdentityContent\`.

**Instructions**:

1. **Compress Aggressively**: Use abbreviations, remove unnecessary words, and focus on key terms.
2. **Retain All Key Points**: Ensure no important information from the current identity or conversation is omitted.
3. **Ignore Readability**: It's acceptable if the result is less readable, as long as it contains more information.
4. **Use Compact Formats**: Consider lists, bullet points, or other formats that allow for dense information packing.
5. **Write for LLM**: Human will not be reading the identity content directly, it must be useful for LLM only.
      
**Current Identity**:
\`\`\`
${currentIdentity}
\`\`\`
`,
    },
  ];

  const result = await generateContentFn(optimizationPrompt, functionDefs, 'updateIdentity', 1, true, options);
  const newIdentity = result.find((call) => call.name === 'updateIdentity')?.args?.newIdentityContent;
  if (newIdentity) {
    putSystemMessage('Identity updated', { newIdentity });
    writeCache('identity', newIdentity);
  }

  return StepResult.CONTINUE;
}
