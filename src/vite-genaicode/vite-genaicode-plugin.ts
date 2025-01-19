import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { ViteDevServer } from 'vite';
import { AddressInfo } from 'net';
import { serviceAutoDetect } from '../cli/service-autodetect.js';
import { stringToAiServiceType } from '../main/codegen-utils.js';
import { CodegenOptions, Plugin } from '../main/codegen-types.js';
import { registerPlugin } from '../main/plugin-loader.js';
import { Service } from '../main/ui/backend/service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let started = false;

const GENAICODE_PORT = 1338;

export default function viteGenaicode(
  options?: Partial<CodegenOptions>,
  config?: { plugins: Plugin[]; genaicodePort?: number },
) {
  let service: Service;
  const genaicodePort = config?.genaicodePort ?? GENAICODE_PORT;
  let appContextEnabled: boolean | undefined;

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

      service = await runCodegenUI({
        ui: true,
        uiPort: genaicodePort,
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

      appContextEnabled = (await service.getRcConfig()).featuresEnabled?.appContext;
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
        `<script type="module" 
  src="/vite-genaicode.js" 
  data-genaicode-port="${genaicodePort}" 
  ${
    appContextEnabled
      ? `data-genaicode-token="${service.getToken()}"
    data-genaicode-app-context-enabled="true"`
      : ``
  }          
>
</script>`,
      );
    },

    resolveId(id: string) {
      if (id === virtualModuleId) {
        return __dirname + '/vite-genaicode-frontend.js';
      }
    },
  };
}
