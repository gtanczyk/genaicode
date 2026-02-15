import { registerActionHandler } from '../step-iterate-handlers.js';
import { ActionHandler, ActionHandlerProps, ActionResult } from '../step-iterate-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';

const handleCodeExecution: ActionHandler = async ({
  prompt,
  options,
  generateContentFn,
}: ActionHandlerProps): Promise<ActionResult> => {
  // Call AI with code execution enabled
  const result = await generateContentFn(
    prompt,
    {
      modelType: ModelType.DEFAULT, // Use default (usually capable) model
      expectedResponseType: {
        text: true,
        codeExecution: true,
        functionCall: false, // Disable other tools to focus on code exec
      },
    },
    options,
  );

  // Parse result into AssistantItem
  // We need to extract text, executableCode, and codeExecutionResult
  const textParts = result
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n');

  const executableCodePart = result.find((p) => p.type === 'executableCode');
  const codeExecutionResultPart = result.find((p) => p.type === 'codeExecutionResult');

  return {
    breakLoop: false,
    items: [
      {
        assistant: {
          type: 'assistant',
          text: textParts,
          executableCode:
            executableCodePart && executableCodePart.type === 'executableCode'
              ? {
                  language: executableCodePart.language,
                  code: executableCodePart.code,
                }
              : undefined,
          codeExecutionResult:
            codeExecutionResultPart && codeExecutionResultPart.type === 'codeExecutionResult'
              ? {
                  outcome: codeExecutionResultPart.outcome,
                  output: codeExecutionResultPart.output,
                }
              : undefined,
        },
        user: {
          type: 'user',
          text: '', // No user input needed immediately after, or maybe just empty to continue loop
        },
      },
    ],
  };
};

registerActionHandler('codeExecution', handleCodeExecution);
