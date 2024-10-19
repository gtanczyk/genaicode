import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { ViteDevServer } from 'vite';
import { AddressInfo } from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let started = false;

const GENAICODE_PORT = 1338;

export default function viteGenaicode() {
  async function start(port: number) {
    if (started) return;

    const { runCodegenUI } = await import('../main/ui/codegen-ui.js');

    started = true;
    console.log('Starting GenAIcode in UI mode...');
    runCodegenUI({
      ui: true,
      uiPort: GENAICODE_PORT,
      uiFrameAncestors: ['http://localhost:' + port],
      aiService: 'vertex-ai',
      isDev: false,
    });
  }

  const virtualModuleId = '/vite-genaicode.js';

  return {
    name: 'vite-genaicode',

    configureServer(server: ViteDevServer) {
      server.httpServer?.once('listening', () => {
        start((server.httpServer!.address() as AddressInfo).port);
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
