import { describe, it, expect } from 'vitest';
import madge from 'madge';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Circular Dependencies', () => {
  it('should not introduce new circular dependencies', async () => {
    const dependencyGraph = await madge(path.join(rootDir, 'src'), {
      fileExtensions: ['ts', 'tsx'],
      detectiveOptions: {
        ts: {
          skipTypeImports: true, // Skip type-only imports
        },
      },
      tsConfig: path.join(rootDir, 'tsconfig.json'),
    });

    const circularDependencies = dependencyGraph.circular();

    // Known circular dependencies that are currently in the codebase
    const knownCircularDeps = [
      ['main/codegen-types.ts', 'prompt/steps/step-iterate/step-iterate-types.ts'],
      ['main/codegen-non-interactive.ts', 'main/codegen.ts'],
      [
        'main/codegen.ts',
        'main/interactive/codegen-interactive.ts',
        'main/interactive/task-file.ts',
        'main/interactive/codegen-worker.ts',
      ],
      [
        'main/codegen.ts',
        'main/ui/codegen-ui.ts',
        'main/ui/backend/server.ts',
        'main/ui/backend/api.ts',
        'main/ui/backend/api-handlers.ts',
        'main/ui/backend/service.ts',
      ],
    ];

    // Helper function to check if a circular dependency is known
    const isKnownCircular = (circular: string[]) => {
      return knownCircularDeps.some((known) => {
        if (known.length !== circular.length) return false;
        return known.every((file, index) => circular[index].includes(file));
      });
    };

    // Filter out unknown circular dependencies
    const unknownCirculars = circularDependencies.filter((circular) => !isKnownCircular(circular));

    // If there are any unknown circular dependencies, fail the test
    if (unknownCirculars.length > 0) {
      console.error('New circular dependencies detected:');
      unknownCirculars.forEach((circular) => {
        console.error(circular.join(' > '));
      });

      throw new Error(`Found ${unknownCirculars.length} new circular dependencies!`);
    }

    // Log known circular dependencies for information
    console.info('Current known circular dependencies:');
    knownCircularDeps.forEach((circular) => {
      console.info(circular.join(' > '));
    });

    // Verify that all known circular dependencies are still present
    // This helps us know when we've successfully removed some circular dependencies
    const currentCirculars = new Set(circularDependencies.map((c) => c.join(' > ')));
    const missingCirculars = knownCircularDeps
      .filter((known) => !currentCirculars.has(known.join(' > ')))
      .map((c) => c.join(' > '));

    if (missingCirculars.length > 0) {
      console.info('Some known circular dependencies have been resolved:');
      missingCirculars.forEach((circular) => {
        console.info(circular);
      });
    }

    // The test passes if we haven't found any new circular dependencies
    expect(unknownCirculars).toHaveLength(0);
  });
});
