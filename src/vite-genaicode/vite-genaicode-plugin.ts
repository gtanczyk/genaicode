import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import { ResolvedConfig, ViteDevServer } from 'vite';
import { AddressInfo } from 'net';
import { CodegenOptions, Plugin } from '../main/codegen-types.js';
import { VIRTUAL_MODULE_ID, GENERATOR_VIRTUAL_MODULE_ID } from './constants.js';
import { GenaicodeServerManager } from './server-manager.js';
import { transformCode } from './code-transformer.js';
import { injectGenaicodeScript } from './html-injector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let codeTransformerWarningLogged = false;

export default function viteGenaicode(
  options?: Partial<CodegenOptions>,
  config?: { plugins?: Plugin[]; genaicodePort?: number; logBufferMaxSize?: number; codeTransformer?: boolean },
) {
  const serverManager = new GenaicodeServerManager(options, config, __filename);
  let port: number;

  return {
    name: 'vite-genaicode',
    enforce: 'pre' as const,

    configResolved(config: ResolvedConfig) {
      // Capture the resolved output directory so generated files land in dist/
      const resolvedOutDir = path.resolve(config.root, config.build.outDir);
      serverManager.outDir = resolvedOutDir;
    },

    configureServer(server: ViteDevServer) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer!.address() as AddressInfo;
        port = address.port;
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
      if (port) {
        await serverManager.ensureService(port);
      } else {
        console.warn('[GenAIcode] Could not determine dev server port. GenAIcode server may not start correctly.');
      }
    },

    async transform(code: string, id: string) {
      if (config?.codeTransformer !== true) {
        if (!codeTransformerWarningLogged) {
          console.info(
            '[GenAIcode] Code transformer is disabled by default. Enable it by passing `codeTransformer: true` in the viteGenaicode plugin config.',
          );
          codeTransformerWarningLogged = true;
        }
        return null;
      }

      if (!port) {
        console.warn('[GenAIcode] Dev server port not available yet. Skipping code transformation for:', id);
        return null;
      }
      await serverManager.ensureService(port);
      const service = serverManager.service;
      if (!service) return null;

      return transformCode(code, id, service, serverManager.outDir);
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
