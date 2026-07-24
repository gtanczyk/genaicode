import { describe, expect, it } from 'vitest';
import { asPrompt, prompt, system, toPromptItems, user } from './prompt.js';

describe('prompt conversion', () => {
  it('normalizes strings, nested inputs, and domain converters', () => {
    const domainValue = asPrompt(() => user('domain'));

    expect(prompt('hello', [system('rules'), [domainValue]])).toEqual([
      { type: 'user', text: 'hello' },
      { type: 'systemPrompt', systemPrompt: 'rules' },
      { type: 'user', text: 'domain' },
    ]);
  });

  it('copies prompt items at the conversion boundary', () => {
    const item = user('original');
    const converted = toPromptItems(item);

    converted[0].text = 'changed';
    expect(item.text).toBe('original');
  });
});
