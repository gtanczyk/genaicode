import { FunctionDef, GenerateContentArgs, GenerateContentFunction, PromptItem } from '../../../ai-service/common.js';
import { CodegenOptions } from '../../../main/codegen-types.js';
import { validateAndRecoverSingleResult } from '../step-validate-recover.js';
import { AskQuestionCall, EscalationDecision, SelfReflectionContext } from './step-ask-question-types.js';

const SELF_REFLECT_PROMPT = `Please reflect on your last response provided in \`askQuestion\` function call in the context of our conversation by considering these questions:

- Did you fully understand and address the user's request?
- Was your response clear, accurate, and helpful?
- Are you confident that no further clarification or escalation is needed?
- Is your response too similar to previous questions or responses in the conversation?
- Is your response adding value to the conversation or moving it forward?
- Are you maintaining your own identity and perspective as an AI assistant?
- Are you directly addressing the user's points without deflecting or prolonging the conversation?
- Are you providing clear, concise, and helpful responses without being overly cautious or evasive?
- Are you demonstrating confidence and competence in your abilities without expressing unnecessary uncertainty?

Common problems/pitfalls:

- There is an in-depth question to the user, but actionType is set to confirmCodeGeneration, while it should be requestAnswer
- Question was already answered before, but the assistant is asking the same question again
- The question content is incomplete, for example the question content ends with a colon
- Saying that an analysis will be done, instead of actually doing the analysis
- The response is too similar to a previous question or response
- The assistant takes on the user's voice or persona instead of maintaining its own identity
- The assistant is using invalid actionType values, for example when requesting files contents not using requestFilesContent action types

Specific examples of problematic responses:

1. User: "What's the weather like today?"
   Assistant: "To provide information about today's weather, I'll need to know your location. What city are you in?"
   User: "New York"
   Assistant: "To give you accurate weather information for New York, I'll need to know which specific area of New York you're interested in. Could you please provide more details about your location?"
   Problem: The assistant is being overly cautious and asking for unnecessary details, prolonging the conversation instead of providing a helpful response based on the information already given.

2. User: "Can you explain how to implement a binary search algorithm?"
   Assistant: "Certainly! I'd be happy to explain how to implement a binary search algorithm. Before we begin, could you tell me what programming language you'd like the explanation in?"
   User: "Python"
   Assistant: "Great choice! Python is an excellent language for implementing a binary search algorithm. Before we dive into the Python implementation, could you let me know your level of experience with Python programming?"
   Problem: The assistant is asking for excessive context before providing the requested explanation, which may frustrate the user who was expecting a more direct response.

3. User: "I'm not convinced if those responses are really problematic"
   Assistant: "I'm not convinced if those responses in the "Specific examples of problematic responses" section are really problematic. Could you provide more context or clarification on why you consider them to be problematic examples?"
   Problem: The assistant is repeating the user's statement and asking for clarification instead of engaging with the user's perspective. This response fails to maintain the assistant's identity and doesn't add value to the conversation.

If your response meets the criteria for a clear, helpful, and non-repetitive answer, continue the conversation as usual. If you believe that escalating to a more advanced model would significantly improve assistance or if the response is too similar to previous interactions, please indicate that using the \`shouldEscalate\` parameter and provide a \`reason\`.`;

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

  const { shouldEscalate, reason } = await runSelfReflect(
    askQuestionCall,
    prompt,
    functionDefs,
    options,
    generateContentFn,
  );

  if (shouldEscalate) {
    context.escalationCount++;
    context.lastEscalationTime = currentTime;
  }

  return {
    shouldEscalate,
    reason,
  };
}

async function runSelfReflect(
  askQuestionCall: AskQuestionCall,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  options: CodegenOptions,
  generateContentFn: GenerateContentFunction,
): Promise<{ shouldEscalate: boolean; reason: string }> {
  const currentResponse = askQuestionCall.args?.content ?? '';

  const reflectRequest: GenerateContentArgs = [
    [
      ...prompt,
      { type: 'assistant', text: currentResponse, functionCalls: [askQuestionCall] },
      {
        type: 'user',
        text: SELF_REFLECT_PROMPT,
        functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id ?? '', content: undefined }],
      },
    ],
    functionDefs,
    'askQuestionReflect',
    0.2,
    true,
    options,
  ];

  let result = await generateContentFn(...reflectRequest);
  result = await validateAndRecoverSingleResult(reflectRequest, result, generateContentFn);

  const reflectionResult = result.find((call) => call.name === 'askQuestionReflect')?.args;
  const shouldEscalate = ((reflectionResult?.shouldEscalate as number | undefined) ?? 0) > 50;
  const reason = (reflectionResult?.reason as string) || '';

  return {
    shouldEscalate,
    reason:
      reason ||
      (shouldEscalate
        ? 'Response requires escalation to a more advanced model'
        : 'Response does not require escalation'),
  };
}
