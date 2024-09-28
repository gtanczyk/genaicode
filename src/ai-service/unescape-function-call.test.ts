import { describe, it, expect } from 'vitest';
import { unescapeFunctionCall } from './unescape-function-call.js';

describe('unescapeFunctionCall', () => {
  it('unescapes double escaped code', () => {
    expect(
      unescapeFunctionCall({
        name: 'test',
        args: {
          content: `console.log(\\"hello world\\");\\nconsole.log(\\'helloooo\\');`,
        },
      }),
    ).toEqual({
      name: 'test',
      args: {
        content: `console.log("hello world");\nconsole.log('helloooo');`,
      },
    });
  });
});
