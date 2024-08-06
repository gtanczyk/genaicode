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

    it('should include the --imagen option in the help message', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      printHelpMessage();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--imagen=<service>'));
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Enable image generation functionality and specify the service to use (either "vertex-ai" or "dall-e").',
        ),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('cliOptions', () => {
    it('should include the --imagen option', () => {
      const imagenOption = cliOptions.find((option) => option.name === '--imagen=<service>');
      expect(imagenOption).toBeDefined();
      expect(imagenOption.description).toBe(
        'Enable image generation functionality and specify the service to use (either "vertex-ai" or "dall-e").',
      );
    });
  });
});
