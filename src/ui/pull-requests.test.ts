import { describe, expect, it, vi } from 'vitest';
import { pullRequestLookup } from './pull-requests.js';

const URL = 'https://github.com/acme/app/pull/351';

describe('pullRequestLookup', () => {
  it('reads the state gh reports, and asks once while the answer is fresh', async () => {
    const run = vi.fn(async () => '{"state":"MERGED"}\n');
    const lookup = pullRequestLookup({ run });
    expect(await lookup(URL)).toBe('merged');
    expect(await lookup(URL)).toBe('merged');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(URL);
    expect(await pullRequestLookup({ run: async () => '{"state":"OPEN"}' })(URL)).toBe('open');
    expect(await pullRequestLookup({ run: async () => '{"state":"CLOSED"}' })(URL)).toBe('closed');
  });

  it('has no answer when gh fails or says something else', async () => {
    const failing = async () => {
      throw new Error('gh: command not found');
    };
    expect(await pullRequestLookup({ run: failing })(URL)).toBeUndefined();
    expect(await pullRequestLookup({ run: async () => 'not json' })(URL)).toBeUndefined();
    expect(await pullRequestLookup({ run: async () => '{"state":"DRAFT"}' })(URL)).toBeUndefined();
  });

  it('hands gh nothing but a pull request address', async () => {
    const run = vi.fn(async () => '{"state":"OPEN"}');
    const lookup = pullRequestLookup({ run });
    for (const url of [
      'https://github.com/acme/app/pull/351 --repo x',
      'https://github.com/acme/app/pull/351/files',
      'https://example.com/acme/app/pull/351',
      '--web',
      '',
    ]) {
      expect(await lookup(url)).toBeUndefined();
    }
    expect(run).not.toHaveBeenCalled();
  });
});
