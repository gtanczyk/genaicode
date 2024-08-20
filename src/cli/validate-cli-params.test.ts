import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateCliParams, getCliParamValue, hasCliParam } from './validate-cli-params.js';

describe('validateCliParams', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    process.argv = ['node', 'script.js'];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('should not throw for valid parameters', () => {
    process.argv.push('--dry-run', '--consider-all-files');
    expect(() => validateCliParams()).not.toThrow();
  });

  it('should throw for invalid parameters', () => {
    process.argv.push('--invalid-param');
    expect(() => validateCliParams()).toThrow();
  });

  it('should throw for parameters without --', () => {
    process.argv.push('invalid-param');
    expect(() => validateCliParams()).toThrow();
  });

  it('should not throw for valid --temperature parameter', () => {
    process.argv.push('--temperature=0.5');
    expect(() => validateCliParams()).not.toThrow();
  });

  it('should throw for invalid --temperature parameter', () => {
    process.argv.push('--temperature=invalid');
    expect(() => validateCliParams()).toThrow();
  });

  it('should throw an error when both vision and vertexAi flags are true', () => {
    process.argv.push('--vision');
    process.argv.push('--vertex-ai');

    expect(() => validateCliParams()).toThrow('--vision and --vertex-ai are currently not supported together.');
  });

  // New tests for --imagen parameter
  it('should not throw for valid --imagen parameter with vertex-ai', () => {
    process.argv.push('--imagen=vertex-ai');
    expect(() => validateCliParams()).not.toThrow();
  });

  it('should not throw for valid --imagen parameter with dall-e', () => {
    process.argv.push('--imagen=dall-e');
    expect(() => validateCliParams()).not.toThrow();
  });

  it('should throw for invalid --imagen parameter value', () => {
    process.argv.push('--imagen=invalid-service');
    expect(() => validateCliParams()).toThrow('Invalid --imagen value. It must be either "vertex-ai" or "dall-e".');
  });

  it('should throw for --imagen parameter without value', () => {
    process.argv.push('--imagen=');
    expect(() => validateCliParams()).toThrow('Invalid --imagen value. It must be either "vertex-ai" or "dall-e".');
  });
});

describe('getCliParamValue', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    process.argv = ['node', 'script.js'];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('should return the value for a parameter with a value', () => {
    process.argv.push('--explicit-prompt=Test prompt');
    expect(getCliParamValue('--explicit-prompt')).toBe('Test prompt');
  });

  it('should return null for a parameter without a value', () => {
    process.argv.push('--dry-run');
    expect(getCliParamValue('--dry-run')).toBeNull();
  });

  it('should return null for a non-existent parameter', () => {
    expect(getCliParamValue('--non-existent')).toBeNull();
  });

  it('should return the value for --temperature parameter', () => {
    process.argv.push('--temperature=0.5');
    expect(getCliParamValue('--temperature')).toBe('0.5');
  });

  it('should return the value for --imagen parameter', () => {
    process.argv.push('--imagen=vertex-ai');
    expect(getCliParamValue('--imagen')).toBe('vertex-ai');
  });
});

describe('hasCliParam', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    process.argv = ['node', 'script.js'];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('should return true for an existing parameter', () => {
    process.argv.push('--dry-run');
    expect(hasCliParam('--dry-run')).toBe(true);
  });

  it('should return false for a non-existent parameter', () => {
    expect(hasCliParam('--non-existent')).toBe(false);
  });

  it('should return true for --temperature parameter', () => {
    process.argv.push('--temperature=0.5');
    expect(hasCliParam('--temperature')).toBe(true);
  });

  it('should return true for --imagen parameter', () => {
    process.argv.push('--imagen=dall-e');
    expect(hasCliParam('--imagen')).toBe(true);
  });
});
