import { describe, expect, it } from 'vitest';
import { hasLeadingBriefing, personText, withBriefing } from './host-text.js';
import { delegationBrief } from './pack.js';
import { handoffPreamble } from './handoff.js';
import type { SessionTurn } from './session.js';

const turn = (id: number, agent: string, prompt: string): SessionTurn => ({
  id,
  agent,
  prompt,
  entries: [],
  startedAt: 0,
  result: { ok: true, status: 'completed', text: 'Done.', exitCode: 0, signal: null },
});

const members: Parameters<typeof delegationBrief>[0] = [{ name: 'codex', installed: true, running: 0, steer: false }];

describe('personText', () => {
  it('keeps what the person wrote', () => {
    expect(personText('  fix the header\n\nplease ')).toBe('fix the header\n\nplease');
  });

  it('drops the tagged briefing after the prompt, also cut short', () => {
    const briefed = withBriefing('fix the header', delegationBrief(members));
    expect(briefed.endsWith('</genaicode-briefing>')).toBe(true);
    expect(personText(briefed)).toBe('fix the header');
    expect(personText(briefed.slice(0, briefed.length - 200))).toBe('fix the header');
    expect(withBriefing('fix it', '  ')).toBe('fix it');
    // Merging two briefings keeps one trailing block that personText strips cleanly.
    const merged = withBriefing(withBriefing('fix it', 'first note'), 'second note');
    expect(merged.match(/<genaicode-briefing>/g)).toHaveLength(1);
    expect(merged).toContain('first note');
    expect(merged).toContain('second note');
    expect(personText(merged)).toBe('fix it');
    // Also when flattened onto one line and cut short in a title/preview.
    const oneLine = briefed.replace(/\s+/g, ' ').slice(0, 95) + '…';
    expect(personText(oneLine)).toBe('fix the header');
  });

  it('keeps a prompt that only mentions the tag', () => {
    expect(personText('Document <genaicode-briefing> in the README.')).toBe(
      'Document <genaicode-briefing> in the README.',
    );
    const own = 'Explain this:\n\n<genaicode-briefing>\n\nsome notes\n\n</genaicode-briefing>';
    expect(personText(own)).toBe(own);
    // Text after the block is the person's, so the block is not the generated trailing one.
    const quoted = `${withBriefing('Why is this here?', 'brief')}\n\nAnd this part too.`;
    expect(personText(quoted)).toBe(quoted);
  });

  it('drops a briefing earlier versions put in front of the prompt', () => {
    const legacy = `${delegationBrief(members, ['docs'])}\n\nfix the header`;
    expect(hasLeadingBriefing(legacy)).toBe(true);
    expect(personText(legacy)).toBe('fix the header');
  });

  it("keeps a person's paragraph that merely starts like a briefing", () => {
    const own = 'Other coding agents on this machine (claude, codex) keep failing.\nWhy?\n\nfix it';
    expect(hasLeadingBriefing(own)).toBe(false);
    expect(personText(own)).toBe(own);
    const lead = 'You lead a pack of coding agents on this machine.\n\nship it';
    expect(personText(lead)).toBe(lead);
  });

  it("drops pack()'s default briefing as older versions sent it", () => {
    const brief = [
      'You lead a pack of coding agents on this machine. Besides doing work yourself, you can hand parts of it to the',
      'others through the `pack` MCP tools. Agents available: codex, gemini.',
      '- `agents` lists them with their limits. `delegate` starts a task on one and returns at once, so several can run',
      '  in parallel. Give each a complete, self-contained prompt: it sees none of this conversation.',
      '- Wait for, and then merge or discard, every task before you finish.',
    ].join('\n');
    expect(personText(`${brief}\n\nship it\n\nthen tag it`)).toBe('ship it\n\nthen tag it');
  });
  it('returns at once for a legacy briefing cut off before its blank line', () => {
    const cut = delegationBrief([]).split('\n').slice(0, 12).join('\n');
    const started = performance.now();
    personText(cut);
    personText(delegationBrief([]));
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('drops the recap an agent taking over a conversation gets, also on one line', () => {
    const preamble = handoffPreamble([turn(1, 'claude', 'Add CSV export')], '.genaicode/handoff/x.handoff.md');
    const taken = `${preamble}Now add a header row`;
    expect(hasLeadingBriefing(taken)).toBe(true);
    expect(personText(taken)).toBe('Now add a header row');
    expect(personText(taken.replace(/\s+/g, ' '))).toBe('Now add a header row');
    // Cut short inside the recap: nothing the person wrote.
    expect(personText(preamble.slice(0, 120))).toBe('');
  });

  it('takes the last recap end when the recap quotes an earlier takeover', () => {
    const earlier = `${handoffPreamble([turn(1, 'codex', 'Fix it')], undefined)}Then test it`;
    const taken = `${handoffPreamble([turn(1, 'codex', earlier)], undefined)}Ship it`;
    expect(personText(taken)).toBe('Ship it');
  });

  it("keeps a person's message that merely mentions taking over", () => {
    const own = 'You are taking over a conversation, so read the notes first.';
    expect(hasLeadingBriefing(own)).toBe(false);
    expect(personText(own)).toBe(own);
  });
});
