/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    include: ['e2e-tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
    ],

    // Default configuration for all tests
    globals: true,
    environment: 'node',

    // Specific configuration for e2e tests
    testTimeout: 30000, // Increase timeout for e2e tests

    maxConcurrency: 1, // Run e2e tests sequentially

    // Use different configurations based on the test type
    typecheck: {
      tsconfig: './tsconfig.json',
    },

    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
