import { Validator } from 'jsonschema';
import { functionDefs } from './function-calling.js';

export function validateFunctionCall(call) {
  const validator = new Validator();
  const functionDef = functionDefs.find((def) => def.name === call.name);

  if (!functionDef) {
    return {
      errors: [
        {
          message: `Function "${call.name}" is not defined.`,
        },
      ],
    };
  }

  const validationResult = validator.validate(call.args, functionDef.parameters);

  if (validationResult.errors.length > 0) {
    return validationResult;
  }

  return undefined;
}
