/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/eval/*.test.ts', 'src/prompt-debug/*.test.ts'],
  },
});
