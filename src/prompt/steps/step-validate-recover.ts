import assert from 'node:assert';
import { GenerateFunctionCallsFunction } from '../../ai-service/common-types.js';
import { GenerateFunctionCallsArgs } from '../../ai-service/common-types.js';
import { FunctionCall } from '../../ai-service/common-types.js';
import { ModelType } from '../../ai-service/common-types.js';
import { validateFunctionCall } from '../function-calling-validate.js';
import { rcConfig } from '../../main/config.js';

export async function validateAndRecoverSingleResult(
  [prompt, functionDefs, requiredFunctionName, temperature, cheap, options]: GenerateFunctionCallsArgs,
  result: FunctionCall[],
  generateContentFn: GenerateFunctionCallsFunction,
  rootDir: string = rcConfig.rootDir,
): Promise<FunctionCall[]> {
  if (!requiredFunctionName) {
    // quite unexpected
    return result;
  }

  let call: FunctionCall | undefined = result[0];
  const validatorError = validateFunctionCall(call, requiredFunctionName, result, rootDir);
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
        text: 'Function call was invalid, you responded, please analyze the error and respond with corrected function call.',
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
    result = await generateContentFn(prompt, functionDefs, requiredFunctionName, temperature, ModelType.CHEAP, options);
    console.log('Recover result:', result);

    if (result?.length === 1) {
      let recoveryError = validateFunctionCall(result[0], requiredFunctionName, result, rootDir);
      if (recoveryError) {
        console.log("Use more expensive recovery method, because we couldn't recover.");
        result = await generateContentFn(
          prompt,
          functionDefs,
          requiredFunctionName,
          temperature,
          ModelType.DEFAULT,
          options,
        );
        recoveryError = validateFunctionCall(result?.[0], requiredFunctionName, result, rootDir);
        assert(!recoveryError, 'Recovery failed');
      }
      console.log('Recovery was successful');
    } else if (result?.length === 0) {
      throw new Error('Did not receive any function calls unexpectedly.');
    } else {
      console.log('Unexpected number of function calls', result);
    }
  }

  return result;
}
