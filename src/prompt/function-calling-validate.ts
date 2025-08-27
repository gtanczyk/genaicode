import { Validator, ValidatorResult, Schema, ValidationError } from 'jsonschema';
import path from 'path';
import { FunctionCall } from '../ai-service/common-types.js';
import { FunctionDef } from '../ai-service/common-types.js';
import { getFunctionDefs } from './function-calling.js';

export function validateFunctionCall(
  call: FunctionCall | undefined,
  requiredFunctionName: string,
  calls: FunctionCall[],
  rootDir: string,
  functionDefs: FunctionDef[] | undefined,
): Omit<ValidatorResult, 'addError'> | undefined {
  const validator = new Validator();
  const functionDef: FunctionDef | undefined = (functionDefs ?? getFunctionDefs()).find(
    (def) => def.name === call?.name,
  );

  // Check if a function was called
  if (!call) {
    return makeError(`Function "${requiredFunctionName}" was not called.`, call, '');
  }

  // Check if only one function was called
  if (calls.length !== 1) {
    return makeError(
      `You called too many functions(${calls.length})! Only one function(${requiredFunctionName}) should be called.`,
      calls,
      '',
    );
  }

  // Check if the function name is correct
  if (call.name !== requiredFunctionName) {
    return makeError(
      `Function "${call.name}" was called, while the expectation was to get "${requiredFunctionName}" function call.`,
      call,
      '',
    );
  }

  // Check if the function is defined
  if (!functionDef) {
    return makeError(`Function "${call.name}" is not defined.`, call, '');
  }

  // Validate against the schema
  const validationResult: ValidatorResult = validator.validate(call.args, functionDef.parameters as unknown as Schema);

  if (validationResult.errors.length > 0) {
    return validationResult;
  }

  // Step 4: Validate file paths
  const filePathValidationError = validateFilePaths(call, rootDir);
  if (filePathValidationError) {
    return filePathValidationError;
  }

  return undefined;
}

function validateFilePaths(call: FunctionCall, rootDir: string) {
  rootDir = path.normalize(rootDir);

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
    'projectFilePath',
    'hostPath',
  ].includes(prop);
}

function makeError(message: string, call: FunctionCall | FunctionCall[] | undefined, propertyPath: string) {
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
