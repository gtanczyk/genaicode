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
});
