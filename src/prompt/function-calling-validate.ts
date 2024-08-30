import { Validator, ValidatorResult, Schema, ValidationError } from 'jsonschema';
import { FunctionDef, FunctionCall } from '../ai-service/common.js';
import { functionDefs } from './function-calling.js';

export function validateFunctionCall(
  call: FunctionCall | undefined,
  requiredFunctionName: string,
): Omit<ValidatorResult, 'addError'> | undefined {
  const validator = new Validator();
  const functionDef: FunctionDef | undefined = functionDefs.find((def) => def.name === call?.name);

  if (!call || call.name !== requiredFunctionName) {
    return makeError(`Function "${requiredFunctionName}" was not called.`, call);
  }

  if (!functionDef) {
    return makeError(`Function "${call.name}" is not defined.`, call);
  }

  const validationResult: ValidatorResult = validator.validate(call.args, functionDef.parameters as unknown as Schema);

  if (validationResult.errors.length > 0) {
    return validationResult;
  }

  return undefined;
}

function makeError(message: string, call: FunctionCall | undefined) {
  return {
    errors: [
      {
        message,
      } as unknown as ValidationError,
    ],
    valid: false,
    instance: call,
    schema: {} as Schema,
    propertyPath: '',
    disableFormat: false,
    throwError: true,
  };
}
