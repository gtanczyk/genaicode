import { describe, expect, it } from 'vitest';
import { pivotNotice } from './pivot-notice.js';

describe('npx pivot notice', () => {
  it('explains the new product and provides exact 1.x fallback paths', () => {
    expect(pivotNotice).toContain('backend LLM toolkit, not a coding agent');
    expect(pivotNotice).toContain('npx genaicode@1');
    expect(pivotNotice).toContain('npm install genaicode@1');
    expect(pivotNotice).toContain('github.com/gtanczyk/genaicode/tree/1.x');
  });
});
