import { describe, it, expect } from 'vitest';
import { verifySystemPromptLimit, verifyCodegenPromptLimit, verifySourceCodeLimit } from './limits.ts';

describe('Prompt Limits', () => {
  describe('verifySystemPromptLimit', () => {
    it('should not throw for a prompt within the limit', () => {
      const validPrompt = 'A '.repeat(200 - 1);
      expect(() => verifySystemPromptLimit(validPrompt)).not.toThrow();
    });

    it('should throw for a prompt exceeding the limit', () => {
      const invalidPrompt = 'A '.repeat(201);
      expect(() => verifySystemPromptLimit(invalidPrompt)).toThrow('Token limit exceeded: 202 > 200');
    });
  });

  describe('verifyCodegenPromptLimit', () => {
    it('should not throw for a prompt within the limit', () => {
      const validPrompt = 'B '.repeat(200 - 1);
      expect(() => verifyCodegenPromptLimit(validPrompt)).not.toThrow();
    });

    it('should throw for a prompt exceeding the limit', () => {
      const invalidPrompt = 'B '.repeat(501);
      expect(() => verifyCodegenPromptLimit(invalidPrompt)).toThrow('Token limit exceeded: 502 > 500');
    });
  });

  describe('verifySourceCodeLimit', () => {
    it('should not throw for source code within the limit', () => {
      const validSourceCode = 'C '.repeat(20000 - 1);
      expect(() => verifySourceCodeLimit(validSourceCode)).not.toThrow();
    });

    it('should throw for source code exceeding the limit', () => {
      const invalidSourceCode = 'C '.repeat(20001);
      expect(() => verifySourceCodeLimit(invalidSourceCode)).toThrow('Token limit exceeded: 20002 > 20000');
    });
  });
});
