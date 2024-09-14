import { CodegenOptions } from '../codegen-types.js';
import { startServer } from './backend/server.js';

export async function runCodegenUI(options: CodegenOptions) {
  console.log('Starting Genaicode Web UI');

  await startServer(options);

  console.log('Genaicode Web UI started');
}
