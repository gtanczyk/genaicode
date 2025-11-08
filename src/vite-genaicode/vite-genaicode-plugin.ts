import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { ViteDevServer } from 'vite';
import { AddressInfo } from 'net';
import { serviceAutoDetect } from '../cli/service-autodetect.js';
import { stringToAiServiceType } from '../main/codegen-utils.js';
import { CodegenOptions, Plugin } from '../main/codegen-types.js';
import { registerPlugin } from '../main/plugin-loader.js';
import { Service } from '../main/ui/backend/service.js';
import { Server } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GENAICODE_PORT = 1338;

export default function viteGenaicode(
  options?: Partial<CodegenOptions>,
  config?: { plugins: Plugin[]; genaicodePort?: number; logBufferMaxSize?: number },
) {
  let codegenService: Service;
  let codegenServer: Server;
  const genaicodePort = config?.genaicodePort ?? GENAICODE_PORT;
  let appContextEnabled: boolean | undefined;

  async function start(port: number) {
    try {
      // Register inline plugins if provided
      for (const plugin of config?.plugins ?? []) {
        await registerPlugin(plugin, __filename);
      }

      const { runCodegenUI } = await import('../main/ui/codegen-ui.js');

      console.log('Starting GenAIcode in UI mode...');

      const codegen = await runCodegenUI({
        ui: true,
        uiPort: genaicodePort,
        uiFrameAncestors: ['http://localhost:' + port],
        aiService: options?.aiService ?? stringToAiServiceType(serviceAutoDetect()),
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

      codegenService = codegen.service;
      codegenServer = codegen.server;

      const genaicodeConfig = await codegenService.getRcConfig();

      if (typeof genaicodeConfig?.featuresEnabled?.appContext === 'undefined') {
        genaicodeConfig.featuresEnabled = {
          ...genaicodeConfig.featuresEnabled,
          appContext: true,
        };
      }

      appContextEnabled = genaicodeConfig.featuresEnabled?.appContext;
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

      server.httpServer?.on('close', () => {
        console.log('Stopping GenAIcode...');
        codegenServer.close();
      });
    },

    transformIndexHtml(html: string) {
      const logBufferMaxSize = config?.logBufferMaxSize ?? 1000;
      return html.replace(
        '</body>',
        `<script type="module" 
  src="/vite-genaicode.js" 
  data-genaicode-port="${genaicodePort}" 
  ${
    appContextEnabled
      ? `data-genaicode-token="${codegenService.getToken()}"
    data-genaicode-app-context-enabled="true"
    data-genaicode-log-buffer-max-size="${logBufferMaxSize}"`
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
