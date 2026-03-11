import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ViteDevServer } from 'vite';
import { AddressInfo } from 'net';
import { CodegenOptions, Plugin } from '../main/codegen-types.js';
import { VIRTUAL_MODULE_ID, GENERATOR_VIRTUAL_MODULE_ID } from './constants.js';
import { GenaicodeServerManager } from './server-manager.js';
import { transformCode } from './code-transformer.js';
import { injectGenaicodeScript } from './html-injector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default function viteGenaicode(
  options?: Partial<CodegenOptions>,
  config?: { plugins?: Plugin[]; genaicodePort?: number; logBufferMaxSize?: number },
) {
  const serverManager = new GenaicodeServerManager(options, config, __filename);

  return {
    name: 'vite-genaicode',
    enforce: 'pre' as const,

    configureServer(server: ViteDevServer) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer!.address() as AddressInfo;
        serverManager.ensureService(address.port).catch((error) => {
          console.error('Failed to start GenAIcode server:', error);
          server.close();
        });
      });

      server.httpServer?.on('close', () => {
        serverManager.close();
      });
    },

    async buildStart() {
      await serverManager.ensureService();
    },

    async transform(code: string, id: string) {
      await serverManager.ensureService();
      const service = serverManager.service;
      if (!service) return null;

      return transformCode(code, id, service);
    },

    transformIndexHtml(html: string) {
      const logBufferMaxSize = config?.logBufferMaxSize ?? 1000;
      return injectGenaicodeScript(html, {
        genaicodePort: serverManager.port,
        appContextEnabled: serverManager.isAppContextEnabled,
        token: serverManager.service?.getToken(),
        logBufferMaxSize,
      });
    },

    resolveId(id: string) {
      if (id === VIRTUAL_MODULE_ID) {
        return __dirname + '/vite-genaicode-frontend.js';
      }
      if (id === GENERATOR_VIRTUAL_MODULE_ID) {
        return '\0' + GENERATOR_VIRTUAL_MODULE_ID;
      }
    },

    load(id: string) {
      if (id === '\0' + GENERATOR_VIRTUAL_MODULE_ID) {
        return `export function dynamicFunction() {
          console.warn('dynamicFunction was called but not transformed by GenAIcode plugin.');
        }`;
      }
    },
  };
}
