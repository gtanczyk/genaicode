import { CodegenOptions } from '../main/codegen-types.js';
import { FunctionCall } from '../ai-service/common-types.js';
import { getOperationExecutor } from '../operations/operations-index.js';
import { putSystemMessage } from '../main/common/content-bus.js';

/**
 * @param functionCalls Result of the code generation, a map of file paths to new content
 * @returns A list of failed operations
 */
export async function updateFiles(functionCalls: FunctionCall[], options: CodegenOptions): Promise<FunctionCall[]> {
  const failedOperations: FunctionCall[] = [];
  for (const call of functionCalls) {
    const { name, args } = call;
    const executor = getOperationExecutor(name);
    if (!executor) {
      console.warn(`Unknown operation: ${name}`);
    } else if (args === undefined) {
      console.warn(`Operation ${name} has no arguments`);
    } else {
      try {
        await executor(args, options);
      } catch (e) {
        putSystemMessage(`Operation ${name} failed with error: ${(e as Error).message}`);
        failedOperations.push(call);
      }
    }
  }
  return failedOperations;
}
