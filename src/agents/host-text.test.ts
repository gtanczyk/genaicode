import { describe, expect, it } from 'vitest';
import { personText, withBriefing } from './host-text.js';
import { delegationBrief } from './pack.js';

const members: Parameters<typeof delegationBrief>[0] = [{ name: 'codex', installed: true, running: 0, steer: false }];

describe('personText', () => {
  it('keeps what the person wrote', () => {
    expect(personText('  fix the header\n\nplease ')).toBe('fix the header\n\nplease');
  });

  it('drops a tagged briefing after the prompt', () => {
    expect(personText(withBriefing('fix the header', delegationBrief(members)))).toBe('fix the header');
    expect(withBriefing('fix it', '  ')).toBe('fix it');
  });

  it('drops a briefing earlier versions put in front of the prompt', () => {
    expect(personText(`${delegationBrief(members, ['docs'])}\n\nfix the header`)).toBe('fix the header');
    expect(personText('You lead a pack of coding agents on this machine. Besides…\n- `agents` lists\n\nship it')).toBe(
      'ship it',
    );
  });
});
