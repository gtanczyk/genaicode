import { describe, it, expect, vi } from 'vitest';
import { printHelpMessage, cliOptions } from './cli-options.js';

describe('CLI Options', () => {
  describe('printHelpMessage', () => {
    it('should print the help message with all CLI options', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      printHelpMessage();

      expect(consoleSpy).toHaveBeenCalledWith('GenAIcode - AI-powered code generation tool');
      expect(consoleSpy).toHaveBeenCalledWith('\nUsage: npx genaicode [options]');
      expect(consoleSpy).toHaveBeenCalledWith('\nOptions:');

      cliOptions.forEach((option) => {
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(option.name));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(option.description));
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('For more information'));

      consoleSpy.mockRestore();
    });
  });
});
