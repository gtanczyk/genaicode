import { defineConfig } from 'vite';
import viteGenaicode from '../../dist/vite-genaicode/vite-genaicode-plugin.js';

export default defineConfig({
  plugins: [
    viteGenaicode({
      imagen: 'dall-e',
    }),
  ],
});
