import { describe, expect, it } from 'vitest';
import { toolDiff } from './format.js';

const shown = (input: unknown) => toolDiff(input)?.lines.map((line) => `${line.sign}${line.text}`);

describe('toolDiff', () => {
  it('reads one replacement, keeping the lines both ends share', () => {
    expect(shown({ file_path: 'a', old_string: 'x\ny\nz', new_string: 'x\nY\nz' })).toEqual([' x', '-y', '+Y', ' z']);
    expect(toolDiff({ oldString: 'a', newString: 'a\nb' })).toMatchObject({ added: 1, removed: 0, more: 0 });
    // Text taken out, down to nothing, and put into nothing.
    expect(shown({ old_string: 'remove me', new_string: '' })).toEqual(['-remove me']);
    expect(shown({ old_string: '', new_string: 'new' })).toEqual(['+new']);
    expect(shown({ old_str: 'a\nb', new_str: 'a' })).toEqual([' a', '-b']);
  });

  it('reads several replacements, a written file and a patch', () => {
    expect(
      shown({
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
        ],
      }),
    ).toEqual(['-a', '+b', ' ⋯', '-c', '+d']);
    expect(shown({ file_path: 'new.txt', content: 'one\ntwo' })).toEqual(['+one', '+two']);
    const patch = '*** Begin Patch\n*** Update File: a.ts\n@@\n keep\n-old\n+new\n*** End Patch';
    expect(shown({ patch })).toEqual([' *** Update File: a.ts', ' @@', ' keep', '-old', '+new']);
    expect(shown(patch)).toEqual(shown({ patch }));
    expect(shown('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b')).toEqual([' @@ -1 +1 @@', '-a', '+b']);
  });

  it('keeps changed lines that look like file headers, and survives a huge file', () => {
    const sql = 'diff --git a/q.sql b/q.sql\n--- a/q.sql\n+++ b/q.sql\n@@ -1 +1 @@\n--- old comment\n+++ plus';
    expect(shown(sql)).toEqual([' @@ -1 +1 @@', '--- old comment', '+++ plus']);
    expect(toolDiff(sql)).toMatchObject({ added: 1, removed: 1 });
    const huge = 'x\n'.repeat(200_000);
    expect(toolDiff({ path: 'large.txt', content: huge })?.added).toBe(200_000);
    expect(toolDiff({ old_string: huge, new_string: `y\n${huge}` })?.added).toBe(1);
  });

  it('is nothing for a call that changes no file', () => {
    expect(toolDiff({ command: 'ls -la' })).toBeUndefined();
    expect(toolDiff({ content: 'no path' })).toBeUndefined();
    expect(toolDiff('just words')).toBeUndefined();
    expect(toolDiff(undefined)).toBeUndefined();
    expect(toolDiff(['a'])).toBeUndefined();
  });

  it('tells the next file of a patch from a changed line that looks like a header', () => {
    const two = [
      '--- a/one.txt',
      '+++ b/one.txt',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '--- a/two.txt',
      '+++ b/two.txt',
      '@@ -1,2 +1,2 @@',
      ' keep',
      '--- old',
      '+++ new',
    ].join('\n');
    const diff = toolDiff(two);
    expect(diff).toMatchObject({ added: 2, removed: 2 });
    expect(diff?.lines.filter((line) => line.sign !== ' ').map((line) => line.text)).toEqual([
      'a',
      'b',
      '-- old',
      '++ new',
    ]);
  });

  it('keeps the change in view when a long text around it stays the same', () => {
    const shared = Array.from({ length: 500 }, (_, i) => `l${i}`);
    const diff = toolDiff({
      old_string: [...shared, 'old', ...shared].join('\n'),
      new_string: [...shared, 'new', ...shared].join('\n'),
    });
    expect(diff).toMatchObject({ added: 1, removed: 1, more: 0 });
    expect(diff?.lines.map((line) => `${line.sign}${line.text}`)).toEqual([
      ' ⋯',
      ' l497',
      ' l498',
      ' l499',
      '-old',
      '+new',
      ' l0',
      ' l1',
      ' l2',
      ' ⋯',
    ]);
  });

  it('counts no line for the newline that ends a text', () => {
    expect(toolDiff({ path: 'a.txt', content: 'one\n' })).toMatchObject({ added: 1, removed: 0 });
    expect(toolDiff({ path: 'a.txt', content: '' })).toBeUndefined();
    expect(toolDiff({ old_string: 'one\n', new_string: '' })).toMatchObject({ added: 0, removed: 1 });
    expect(toolDiff({ old_string: 'one\n', new_string: 'one\ntwo\n' })).toMatchObject({ added: 1, removed: 0 });
    expect(toolDiff('@@ -1 +1 @@\n-a\n+b\n')?.lines).toHaveLength(3);
    // Dropping only that newline is still a change to the last line.
    expect(toolDiff({ old_string: 'a\none\n', new_string: 'a\none' })?.lines).toEqual([
      { sign: ' ', text: 'a' },
      { sign: '-', text: 'one' },
      { sign: '+', text: 'one (no newline at end)' },
    ]);
  });

  it('reads a patch of several files with whole files added and removed', () => {
    const patch = [
      '--- /w/a.txt',
      '+++ /w/a.txt',
      '@@ -1 +1 @@',
      '-first',
      '+hello',
      '--- /dev/null',
      '+++ /w/new.txt',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
    ].join('\n');
    expect(toolDiff(patch)).toMatchObject({ added: 3, removed: 1 });
  });

  it('cuts a long change and says how much is left out', () => {
    const long = toolDiff({ path: 'big', content: Array.from({ length: 450 }, (_, i) => `l${i}`).join('\n') });
    expect(long).toMatchObject({ added: 450, more: 50 });
    expect(long?.lines).toHaveLength(400);
  });
});
