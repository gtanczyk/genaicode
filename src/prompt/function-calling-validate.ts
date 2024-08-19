import { Validator, ValidatorResult, Schema, ValidationError } from 'jsonschema';
import { FunctionDef, FunctionCall } from '../ai-service/common.ts';
import { functionDefs } from './function-calling.ts';

export function validateFunctionCall(call: FunctionCall): Omit<ValidatorResult, 'addError'> | undefined {
  const validator = new Validator();
  const functionDef: FunctionDef | undefined = functionDefs.find((def) => def.name === call.name);

  if (!functionDef) {
    return {
      errors: [
        {
          message: `Function "${call.name}" is not defined.`,
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

  const validationResult: ValidatorResult = validator.validate(call.args, functionDef.parameters as unknown as Schema);

  if (validationResult.errors.length > 0) {
    return validationResult;
  }

  return undefined;
}
