import { Validator, ValidatorResult, Schema, ValidationError } from 'jsonschema';
import path from 'path';
import { FunctionDef, FunctionCall } from '../ai-service/common.js';
import { functionDefs } from './function-calling.js';
import { rcConfig } from '../main/config.js';

export function validateFunctionCall(
  call: FunctionCall | undefined,
  requiredFunctionName: string,
): Omit<ValidatorResult, 'addError'> | undefined {
  const validator = new Validator();
  const functionDef: FunctionDef | undefined = functionDefs.find((def) => def.name === call?.name);

  // Step 1: Check if the function name matches
  if (!call || call.name !== requiredFunctionName) {
    return makeError(`Function "${requiredFunctionName}" was not called.`, call, '');
  }

  // Step 2: Check if the function is defined
  if (!functionDef) {
    return makeError(`Function "${call.name}" is not defined.`, call, '');
  }

  // Step 3: Validate against the schema
  const validationResult: ValidatorResult = validator.validate(call.args, functionDef.parameters as unknown as Schema);

  if (validationResult.errors.length > 0) {
    return validationResult;
  }

  // Step 4: Validate file paths
  const filePathValidationError = validateFilePaths(call);
  if (filePathValidationError) {
    return filePathValidationError;
  }

  return undefined;
}

function validateFilePaths(call: FunctionCall) {
  const rootDir = path.normalize(rcConfig.rootDir);

  function checkPaths(obj: unknown, parentKey: string = ''): ValidationError[] {
    const errors: ValidationError[] = [];

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        if (typeof item === 'string' && isPathProperty(parentKey)) {
          errors.push(...validatePath(item, `${parentKey}[${index}]`));
        } else if (typeof item === 'object' && item !== null) {
          errors.push(...checkPaths(item, `${parentKey}[${index}]`));
        }
      });
    } else if (typeof obj === 'object' && obj !== null) {
      for (const [key, value] of Object.entries(obj)) {
        const currentKey = parentKey ? `${parentKey}.${key}` : key;
        if (typeof value === 'string' && isPathProperty(key)) {
          errors.push(...validatePath(value, currentKey));
        } else if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
          errors.push(...checkPaths(value, currentKey));
        }
      }
    }

    return errors;
  }

  function validatePath(value: string, key: string): ValidationError[] {
    const errors: ValidationError[] = [];
    const normalizedPath = path.normalize(value);
    if (!path.isAbsolute(value)) {
      errors.push(makeError(`File path "${value}" is not absolute.`, call, key).errors[0]);
    } else if (!normalizedPath.startsWith(rootDir)) {
      errors.push(
        makeError(`File path "${value}" is not inside the root directory "${rootDir}".`, call, key).errors[0],
      );
    }
    return errors;
  }

  const errors = checkPaths(call.args);
  if (errors.length > 0) {
    return { errors, valid: false } as ValidatorResult;
  }

  return undefined;
}

function isPathProperty(prop: string): boolean {
  return [
    'filePath',
    'source',
    'destination',
    'inputFilePath',
    'outputFilePath',
    'contextPaths',
    'filePaths',
    'requestFilesContent',
  ].includes(prop);
}

function makeError(message: string, call: FunctionCall | undefined, propertyPath: string) {
  return {
    errors: [
      {
        message,
      } as unknown as ValidationError,
    ],
    valid: false,
    instance: call,
    schema: {} as Schema,
    propertyPath,
    disableFormat: false,
    throwError: true,
  };
}
