import assert from 'node:assert';
import { GenerateContentArgs, GenerateContentFunction, GenerateContentResult } from '../../ai-service/common-types.js';
import { FunctionCall } from '../../ai-service/common-types.js';
import { ModelType } from '../../ai-service/common-types.js';
import { validateFunctionCall } from '../function-calling-validate.js';
import { rcConfig } from '../../main/config.js';

export async function validateAndRecoverSingleResult(
  [prompt, { functionDefs, requiredFunctionName, temperature, modelType }, options]: GenerateContentArgs,
  result: GenerateContentResult,
  generateContentFn: GenerateContentFunction,
  rootDir: string = rcConfig.rootDir,
): Promise<GenerateContentResult> {
  if (!requiredFunctionName) {
    // quite unexpected
    return result;
  }

  let calls = result.filter((item) => item.type === 'functionCall').map((item) => item.functionCall);

  let call: FunctionCall | undefined = calls[0];
  const validatorError = validateFunctionCall(call, requiredFunctionName, calls, rootDir);
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
    if (modelType === ModelType.CHEAP) {
      console.log('Disabling --cheap for recovery.');
    }
    calls = (
      await generateContentFn(
        prompt,
        {
          functionDefs,
          requiredFunctionName,
          temperature,
          modelType: ModelType.CHEAP,
          expectedResponseType: { text: false, functionCall: true, media: false },
        },
        options,
      )
    )
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall);
    console.log('Recover result:', result);

    if (calls?.length === 1) {
      let recoveryError = validateFunctionCall(calls[0], requiredFunctionName, calls, rootDir);
      if (recoveryError) {
        console.log("Use more expensive recovery method, because we couldn't recover.");
        result = await generateContentFn(
          prompt,
          { functionDefs, requiredFunctionName, temperature, modelType: ModelType.DEFAULT },
          options,
        );
        recoveryError = validateFunctionCall(calls?.[0], requiredFunctionName, calls, rootDir);
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
