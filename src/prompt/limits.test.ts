import { describe, it, expect } from 'vitest';
import { verifySystemPromptLimit, verifyCodegenPromptLimit, verifySourceCodeLimit } from './limits.js';

describe('Prompt Limits', () => {
  describe('verifySystemPromptLimit', () => {
    it('should not throw for a prompt within the limit', () => {
      const validPrompt = 'A '.repeat(200 - 1);
      expect(() => verifySystemPromptLimit(validPrompt)).not.toThrow();
    });

    it('should throw for a prompt exceeding the limit', () => {
      const invalidPrompt = 'A '.repeat(5000);
      expect(() => verifySystemPromptLimit(invalidPrompt)).toThrow('Token limit exceeded: 3250 > 2800');
    });
  });

  describe('verifyCodegenPromptLimit', () => {
    it('should not throw for a prompt within the limit', () => {
      const validPrompt = 'B '.repeat(200 - 1);
      expect(() => verifyCodegenPromptLimit(validPrompt)).not.toThrow();
    });

    it('should throw for a prompt exceeding the limit', () => {
      const invalidPrompt = 'B '.repeat(10000);
      expect(() => verifyCodegenPromptLimit(invalidPrompt)).toThrow('Token limit exceeded: 6500 > 850');
    });
  });

  describe('verifySourceCodeLimit', () => {
    it('should not throw for source code within the limit', () => {
      const validSourceCode = 'C '.repeat(40000 - 1);
      expect(() => verifySourceCodeLimit(validSourceCode)).not.toThrow();
    });

    it('should throw for source code exceeding the limit', () => {
      const invalidSourceCode = 'C '.repeat(400001);
      expect(() => verifySourceCodeLimit(invalidSourceCode)).toThrow('Token limit exceeded: 260001 > 100000');
    });
  });
});
