import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { ViteDevServer } from 'vite';
import { AddressInfo } from 'net';
import { serviceAutoDetect } from '../cli/service-autodetect.js';
import { stringToAiServiceType } from '../main/codegen-utils.js';
import { CodegenOptions, Plugin } from '../main/codegen-types.js';
import { registerPlugin } from '../main/plugin-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let started = false;

const GENAICODE_PORT = 1338;

export default function viteGenaicode(options?: Partial<CodegenOptions>, config?: { plugins: Plugin[] }) {
  async function start(port: number) {
    if (started) {
      console.log('GenAIcode UI is already started');
      return;
    }

    try {
      // Register inline plugins if provided
      for (const plugin of config?.plugins ?? []) {
        await registerPlugin(plugin, __filename);
      }

      const { runCodegenUI } = await import('../main/ui/codegen-ui.js');

      started = true;
      console.log('Starting GenAIcode in UI mode...');

      await runCodegenUI({
        ui: true,
        uiPort: GENAICODE_PORT,
        uiFrameAncestors: ['http://localhost:' + port],
        aiService: stringToAiServiceType(serviceAutoDetect()),
        isDev: false,

        allowFileCreate: true,
        allowFileDelete: true,
        allowDirectoryCreate: true,
        allowFileMove: true,
        vision: true,

        temperature: 0.7,
        requireExplanations: true,
        askQuestion: true,
        historyEnabled: true,

        conversationSummaryEnabled: true,

        ...options,
      });
    } catch (error) {
      console.error('Failed to start GenAIcode UI:', error);
      throw error;
    }
  }

  const virtualModuleId = '/vite-genaicode.js';

  return {
    name: 'vite-genaicode',

    configureServer(server: ViteDevServer) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer!.address() as AddressInfo;
        start(address.port).catch((error) => {
          console.error('Failed to start GenAIcode server:', error);
          server.close();
        });
      });
    },

    transformIndexHtml(html: string) {
      return html.replace(
        '</body>',
        `<script type="module" src="/vite-genaicode.js" data-genaicode-port="${GENAICODE_PORT}"></script>`,
      );
    },

    resolveId(id: string) {
      if (id === virtualModuleId) {
        return __dirname + '/vite-genaicode-frontend.js';
      }
    },
  };
}
