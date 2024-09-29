import { FunctionDef, GenerateContentFunction, PromptItem } from '../../ai-service/common';
import { CodegenOptions } from '../../main/codegen-types';
import { AskQuestionCall, EscalationDecision, SelfReflectionContext } from './step-ask-question-types.js';

export async function performSelfReflection(
  askQuestionCall: AskQuestionCall,
  context: SelfReflectionContext,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  options: CodegenOptions,
  generateContentFn: GenerateContentFunction,
): Promise<EscalationDecision> {
  if (!options.selfReflectionEnabled) {
    return {
      shouldEscalate: false,
      reason: 'Self-reflection is disabled by user configuration.',
    };
  }

  const currentTime = Date.now();

  const shouldEscalate = await runSelfReflect(askQuestionCall, prompt, functionDefs, options, generateContentFn);

  if (shouldEscalate) {
    context.escalationCount++;
    context.lastEscalationTime = currentTime;
  }

  return {
    shouldEscalate,
    reason: shouldEscalate
      ? 'Response must be escalated to non cheap model'
      : 'Response should not be escalated to non cheap model',
  };
}

async function runSelfReflect(
  askQuestionCall: AskQuestionCall,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  options: CodegenOptions,
  generateContentFn: GenerateContentFunction,
) {
  const result = await generateContentFn(
    [
      ...prompt,

      { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [askQuestionCall] },
      {
        type: 'user',
        text: `Please reflect on your last response provided in \`askQuestion\` function call in the context of our conversation by considering these questions:

- Did you fully understand and address the user's request?
- Was your response clear, accurate, and helpful?
- Are you confident that no further clarification or escalation is needed?

If your response meets these criteria, continue the conversation as usual. If you believe that escalating to a more advanced model would significantly improve assistance, please indicate that using the \`shouldEscalate\` parameter.`,
        functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined }],
      },
    ],
    functionDefs,
    'askQuestionReflect',
    0.2,
    true,
    options,
  );
  const shouldEscalate = result.find((call) => call.name === 'askQuestionReflect')?.args?.shouldEscalate as number;
  return shouldEscalate > 50;
}
