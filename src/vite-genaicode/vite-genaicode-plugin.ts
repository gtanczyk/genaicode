import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { ViteDevServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let started = false;

const GENAICODE_PORT = 1338;

export default function viteGenaicode() {
  async function start() {
    if (started) return;

    const { runCodegenUI } = await import('../main/ui/codegen-ui.js');

    started = true;
    console.log('Starting GenAIcode in UI mode...');
    runCodegenUI({
      ui: true,
      uiPort: GENAICODE_PORT,
      uiFrameAncestors: ['http://localhost:5173'],
      aiService: 'vertex-ai',
      isDev: false,
    });
  }

  const virtualModuleId = '/vite-genaicode.js';

  return {
    name: 'vite-genaicode',

    configureServer(server: ViteDevServer) {
      server.httpServer?.once('listening', () => {
        start();
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
