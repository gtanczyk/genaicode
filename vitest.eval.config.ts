/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    include: ['src/eval/**/*.test.ts'],
    fileParallelism: false,
    retry: 1,
    onConsoleLog: () => false,
    watch: false,
    reporters: ['json', 'default'],
    outputFile: {
      json: 'src/eval/results.json',
    },
  },
});
