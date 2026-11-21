/// <reference types="vitest" />
import { defineConfig } from 'vite';

// One config, three projects: `npm test` runs `unit`, the other two have their own scripts.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          // Agent runs in tests keep no plan limits in the home of whoever runs them.
          env: { GENAICODE_LIMITS: 'off' },
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: ['src/**/*.e2e.test.ts', 'src/**/*.browser.test.ts', 'src/desktop/**'],
        },
      },
      { test: { name: 'e2e', include: ['src/**/*.e2e.test.ts'], exclude: ['src/desktop/**'] } },
      { test: { name: 'browser', include: ['src/**/*.browser.test.ts'], exclude: ['src/desktop/**'] } },
    ],
  },
});
