import { describe, it, expect, afterEach } from 'vitest';
import { serviceAutoDetect } from './service-autodetect';

describe('serviceAutoDetect', () => {
  afterEach(() => {
    // Clean up environment variables after each test
    delete process.env.GOOGLE_CLOUD_PROJECT;
  });

  it('should return "vertex-ai" when GOOGLE_CLOUD_PROJECT is set', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    expect(serviceAutoDetect()).toBe('vertex-ai');
  });

  it('should return null when no service is configured', () => {
    expect(serviceAutoDetect()).toBeNull();
  });

  it('should prioritize anthropic over other services', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    expect(serviceAutoDetect()).toBe('vertex-ai');
  });
});
