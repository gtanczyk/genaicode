import { describe, it, expect, afterEach } from 'vitest';
import { serviceAutoDetect } from './service-autodetect.js';

describe('serviceAutoDetect', () => {
  afterEach(() => {
    // Clean up environment variables after each test
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.API_KEY;
  });

  it('should return "anthropic" when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect(serviceAutoDetect()).toBe('anthropic');
  });

  it('should return "openai" when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    expect(serviceAutoDetect()).toBe('openai');
  });

  it('should return "vertex-ai" when GOOGLE_CLOUD_PROJECT is set', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    expect(serviceAutoDetect()).toBe('vertex-ai');
  });

  it('should return null when no service is configured', () => {
    expect(serviceAutoDetect()).toBeNull();
  });

  it('should prioritize anthropic over other services', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    expect(serviceAutoDetect()).toBe('anthropic');
  });

  it('should prioritize openai over vertex-ai', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    expect(serviceAutoDetect()).toBe('openai');
  });
});
