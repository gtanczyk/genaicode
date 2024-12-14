import { updateFiles } from '../files/update-files.js';
import { runCodegenIteration } from './codegen.js';
import { CodegenOptions } from './codegen-types.js';
import { putSystemMessage } from './common/content-bus.js';

export async function runCodegenNonInteractive(options: CodegenOptions): Promise<void> {
  console.log('Executing codegen in non-interactive mode');
  const functionCalls = await runCodegenIteration(options);

  if (!functionCalls || functionCalls.length === 0) {
    putSystemMessage('No updates to apply');
  } else if (options.dryRun) {
    putSystemMessage('Dry run mode, not updating files');
  } else {
    putSystemMessage('Update files');
    await updateFiles(
      functionCalls.filter((call) => call.name !== 'explanation' && call.name !== 'getSourceCode'),
      options,
    );
    putSystemMessage('Initial updates applied');

    console.log('Done!');
  }
}
