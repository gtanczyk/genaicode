/**
 * `genaicode/vite`: chat with a coding agent from inside the app in `vite dev`.
 *
 * ```ts
 * import { defineConfig } from 'vite';
 * import genaicode from 'genaicode/vite';
 *
 * export default defineConfig({ plugins: [genaicode()] });
 * ```
 */
export { genaicode, genaicode as default, type GenaicodeViteOptions } from './vite/plugin.js';
