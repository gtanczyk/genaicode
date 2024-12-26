import { defineConfig } from 'vite';
import viteGenaicode from '../../dist/vite-genaicode/vite-genaicode-plugin.js';

export default defineConfig({
  plugins: [
    viteGenaicode(
      {
        imagen: 'dall-e',
      },
      {
        plugins: [
          {
            name: 'example-inline-plugin',
            generateContentHook: async (args, result) => {
              console.log('Example Inline Plugin generateContent hook', args, result);
            },
          },
        ],
      },
    ),
  ],
});
