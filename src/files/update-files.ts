import { CodegenOptions } from '../main/codegen-types.js';
import { FunctionCall } from '../ai-service/common-types.js';
import { getOperationExecutor } from '../operations/operations-index.js';

/**
 * @param functionCalls Result of the code generation, a map of file paths to new content
 */
export async function updateFiles(functionCalls: FunctionCall[], options: CodegenOptions) {
  for (const { name, args } of functionCalls) {
    const executor = getOperationExecutor(name);
    if (!executor) {
      console.warn(`Unknown operation: ${name}`);
    } else if (args === undefined) {
      console.warn(`Operation ${name} has no arguments`);
    } else {
      await executor(args, options);
    }
  }
}
