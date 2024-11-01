import assert from 'node:assert';
import { FunctionCall, GenerateContentFunction, GenerateContentArgs } from '../../ai-service/common.js';
import { validateFunctionCall } from '../function-calling-validate.js';

export async function validateAndRecoverSingleResult(
  [prompt, functionDefs, requiredFunctionName, temperature, cheap, options]: GenerateContentArgs,
  result: FunctionCall[],
  generateContentFn: GenerateContentFunction,
): Promise<FunctionCall[]> {
  if (result.length > 1 || !requiredFunctionName) {
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

    prompt = [
      ...prompt,
      { type: 'assistant', functionCalls: [call] },
      {
        type: 'user',
        text: 'Function call was invalid, please analyze the error and respond with corrected function call.',
        functionResponses: [
          {
            name: call.name,
            call_id: call.id,
            content: JSON.stringify({ args: call.args, error: validatorError }),
            isError: true,
          },
        ],
      },
    ];

    console.log('Trying to recover...');
    if (cheap) {
      console.log('Disabling --cheap for recovery.');
    }
    result = await generateContentFn(prompt, functionDefs, requiredFunctionName, temperature, false, options);
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
