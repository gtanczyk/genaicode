// Bundle the interactive front ends (Ink terminal UI and the browser app) into dist/ui/.
// They ship inside the genaicode package but load only for `genaicode chat` and `genaicode ui`,
// so the library itself keeps no UI dependencies.
import { cpSync } from 'node:fs';
import { build } from 'esbuild';

const shared = {
  bundle: true,
  minify: true,
  legalComments: 'linked',
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
};

await build({
  ...shared,
  entryPoints: ['src/ui/index.tsx'],
  outfile: 'dist/ui/index.js',
  platform: 'node',
  target: 'node20',
  format: 'esm',
  jsx: 'automatic',
  // Ink loads React DevTools only when DEV=true; that optional package is not shipped.
  plugins: [
    {
      name: 'no-devtools',
      setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: 'devtools', namespace: 'stub' }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export default { initialize() {}, connectToDevTools() {} };',
        }));
      },
    },
  ],
  // Some bundled CommonJS dependencies call require(); give the ESM bundle one.
  banner: {
    js: "import { createRequire as __genaicodeRequire } from 'node:module'; const require = __genaicodeRequire(import.meta.url);",
  },
});

await build({
  ...shared,
  entryPoints: ['src/ui/web/client.tsx'],
  outfile: 'dist/ui/web-client.js',
  platform: 'browser',
  target: 'es2020',
  format: 'esm',
  jsx: 'automatic',
});

// The wolf mascot and its bark, from genaicode 1.0's UI.
cpSync('src/ui/web/assets', 'dist/ui/assets', { recursive: true });
