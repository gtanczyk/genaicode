import { CodegenOptions } from '../codegen-types.js';
import { registerAppContextProvider } from '../common/app-context-bus.js';
import { registerContentHandler } from '../common/content-bus.js';
import { startServer } from './backend/server.js';
import { Service } from './backend/service.js';
import { registerUserActionHandlers } from './user-action-handlers.js';

export async function runCodegenUI(options: CodegenOptions) {
  console.log('Starting Genaicode Web UI');

  const service = new Service(options);

  registerUserActionHandlers(service);
  registerContentHandler((content) => service.handleContent(content));
  registerAppContextProvider(service);

  const server = await startServer(service, {
    uiPort: options.uiPort!,
    additionalFrameAncestors: options.uiFrameAncestors,
  });

  console.log('Genaicode Web UI started');

  return {
    service,
    server,
  };
}
