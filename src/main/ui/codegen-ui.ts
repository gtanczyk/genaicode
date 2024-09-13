import { startServer } from './backend/server.js';

export async function runCodegenUI() {
  console.log('Starting Genaicode Web UI');

  await startServer();

  console.log('Genaicode Web UI started');
}
