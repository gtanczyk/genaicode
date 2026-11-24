import { describe, expect, it } from 'vitest';
import { takeEvents } from './web/sse.js';

describe('takeEvents', () => {
  it('keeps only the newest complete view of a read, delivers the other events, and waits for a split one', () => {
    const view = (n: number) => `event: view\ndata: {"n":${n}}\n\n`;
    const read1 =
      view(1) +
      'event: config\ndata: {"cwd":"/w"}\n\n' +
      view(2) +
      'event: release\ndata: {"v":"1"}\n\n' +
      'event: toast\ndata: {"text":"hi"}\n\n' +
      'event: view\ndata: {"n"';
    const first = takeEvents(read1);
    expect(first.events).toEqual([
      { event: 'config', data: '{"cwd":"/w"}' },
      { event: 'view', data: '{"n":2}' },
      { event: 'release', data: '{"v":"1"}' },
      { event: 'toast', data: '{"text":"hi"}' },
    ]);
    expect(first.rest).toBe('event: view\ndata: {"n"');

    const second = takeEvents(`${first.rest}:3}\n\n`);
    expect(second).toEqual({ events: [{ event: 'view', data: '{"n":3}' }], rest: '' });
  });

  it('joins data lines, names unnamed events message, and skips events without data', () => {
    expect(takeEvents('data: a\r\ndata: b\n\nevent: ping\n\n: comment\n\n')).toEqual({
      events: [{ event: 'message', data: 'a\nb' }],
      rest: '',
    });
  });
});
