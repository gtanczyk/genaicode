import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import checker from 'vite-plugin-checker';

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    outDir: '../../../../dist/main/ui/frontend',
    emptyOutDir: true,
  },
  resolve: {
    preserveSymlinks: true,
  },
  plugins: [react(), checker({ typescript: true })],
});
