/// <reference types="vitest" />
import { defineConfig } from 'vite';
import fs from 'node:fs';

export default defineConfig({
  test: {
    include: ['src/eval/**/*.test.ts'],
    fileParallelism: false,
    retry: 1,
    onConsoleLog: () => false,
    watch: false,
    outputFile: {
      json: 'src/eval/data/results.json',
    },
    reporters: [
      'default',
      'json',
      {
        onFinished: () => {
          process.on('exit', () => {
            const results = fs.readFileSync('./src/eval/data/results.json', 'utf8').replaceAll(process.cwd(), '.');
            fs.writeFileSync(
              './src/eval/data/results.json',
              JSON.stringify(JSON.parse(results), null, 2), // Pretty print with 2 spaces indentation
              'utf8',
            );
          });
        },
      },
    ],
  },
});
