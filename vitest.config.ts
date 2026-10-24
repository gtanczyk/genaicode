/// <reference types="vitest" />
import { defineConfig } from 'vite';

// One config, three projects: `npm test` runs `unit`, the other two have their own scripts.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: ['src/**/*.e2e.test.ts', 'src/**/*.browser.test.ts'],
        },
      },
      { test: { name: 'e2e', include: ['src/**/*.e2e.test.ts'] } },
      { test: { name: 'browser', include: ['src/**/*.browser.test.ts'] } },
    ],
  },
});
