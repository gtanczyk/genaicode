import { CodegenOptions } from '../codegen-types.js';
import { registerContentHandler } from '../common/content-bus.js';
import { startServer } from './backend/server.js';
import { Service } from './backend/service.js';
import { registerUserActionHandlers } from './user-action-handlers.js';

export async function runCodegenUI(options: CodegenOptions) {
  console.log('Starting Genaicode Web UI');

  const service = new Service(options);

  registerUserActionHandlers(service);
  registerContentHandler((content) => service.handleContent(content));

  await startServer(service);

  console.log('Genaicode Web UI started');
}
