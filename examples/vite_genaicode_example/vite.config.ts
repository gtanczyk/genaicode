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
        // codeTransformer is disabled by default. Set to true to enable AI-powered
        // dynamic function generation via the `dynamicFunction` import from 'genaicode:generator'.
        codeTransformer: true,
      },
    ),
  ],
});
