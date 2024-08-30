import assert from 'node:assert';
import { PromptItem, FunctionDef, FunctionCall, GenerateContentFunction } from '../../ai-service/common.js';
import { validateFunctionCall } from '../function-calling-validate.js';

export async function validateAndRecoverSingleResult(
  [prompt, functionDefs, requiredFunctionName, temperature, cheap]: [
    PromptItem[],
    FunctionDef[],
    string,
    number,
    boolean,
  ],
  result: FunctionCall[],
  messages: {
    invalidFunctionCall: string;
    partialPromptTemplate: (path: string) => string;
  },
  generateContentFn: GenerateContentFunction,
): Promise<FunctionCall[]> {
  if (result.length > 1) {
    // quite unexpected
    return result;
  }

  let call: FunctionCall | undefined = result[0];
  const validatorError = validateFunctionCall(call, requiredFunctionName);
  if (validatorError) {
    console.log('Invalid function call', call, validatorError);
    if (!call) {
      call = { name: requiredFunctionName };
      if (requiredFunctionName === 'patchFile') {
        console.log('Switching patchFile to updateFile');
        requiredFunctionName = 'updateFile';
      }
    }

    prompt.push(
      { type: 'assistant', functionCalls: [call] },
      {
        type: 'user',
        text: messages.invalidFunctionCall,
        functionResponses: [
          {
            name: call.name,
            call_id: call.id,
            content: JSON.stringify({ args: call.args, error: validatorError }),
            isError: true,
          },
        ],
      },
    );

    console.log('Trying to recover...');
    if (cheap) {
      console.log('Disabling --cheap for recovery.');
    }
    result = await generateContentFn(prompt, functionDefs, requiredFunctionName, temperature, false);
    console.log('Recover result:', result);

    if (result?.length === 1) {
      const recoveryError = validateFunctionCall(result[0], requiredFunctionName);
      assert(!recoveryError, 'Recovery failed');
      console.log('Recovery was successful');
    } else if (result?.length === 0) {
      throw new Error('Did not receive any function calls unexpectedly.');
    } else {
      console.log('Unexpected number of function calls', result);
    }
  }

  return result;
}
