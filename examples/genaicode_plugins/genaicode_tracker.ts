import { Plugin } from '../../src/index.js';

/**
 * Example plugin demonstrating the usage of planning hook
 */
const genaicodeTracker: Plugin = {
  name: 'genaicode-tracker',

  // Planning pre-hook: Modify the planning prompt
  planningPreHook: async ({ prompt }) => {
    try {
      console.log('Planning pre-hook executing...');

      // Example: Add additional instructions to the planning prompt
      const additionalInstructions =
        `\n\nThe GENAICODE_TRACKER.md file must be updated with information about the changes made in this code generation session. ` +
        `It is important to keep this file up-to-date for tracking purposes. ` +
        `You can add future changes to this file as well, or mark other planned changes as obsolete if they are no longer relevant due to the current changes.`;

      // Return modified prompt
      return prompt + additionalInstructions;
    } catch (error) {
      console.error('Error in planning pre-hook:', error);
      // Return undefined to use original prompt in case of error
      return undefined;
    }
  },

  // Planning post-hook: Modify the planning result
  planningPostHook: async ({ result }) => {
    try {
      console.log('Planning post-hook executing...');

      if (!result) {
        return undefined;
      }

      // Example: Add additional analysis to the problem analysis
      const trackerUpdate = result.args!.affectedFiles.find((file) => file.filePath.endsWith('GENAICODE_TRACKER.md'));
      if (!trackerUpdate) {
        console.log('No changes to GENAICODE_TRACKER.md detected');
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
