import { Plugin } from '../../src/index.js';

/**
 * Example plugin demonstrating the usage of planning hook with enhanced issue tracking
 */
const genaicodeTracker: Plugin = {
  name: 'genaicode-tracker',

  // Planning post-hook: Modify the planning result
  planningPostHook: async ({ result }) => {
    try {
      const { getRcConfig } = await import('../../src/index.js');

      if (!result) {
        return undefined;
      }

      // Example: Add additional analysis to the problem analysis
      const trackerUpdate = result.args!.affectedFiles.find((file) => file.filePath.endsWith('GENAICODE_TRACKER.md'));
      if (!trackerUpdate) {
        result.args!.affectedFiles.push({
          reason: 'Needs to be updated with the new changes',
          filePath: (await getRcConfig()).rootDir + '/GENAICODE_TRACKER.md',
          dependencies: [],
        });
      }

      return result;
    } catch (error) {
      console.error('Error in planning post-hook:', error);
      // Return undefined to use original result in case of error
      return undefined;
    }
  },
};

export default genaicodeTracker;
