// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { entryParts, parse, titleErrors } from '../../../scripts/changelog.mjs';
import { execFileSync } from 'node:child_process';
import { ReleaseNotes } from './release-notes.js';

const body = `Window highlights.

### Added

- **Browse changes.** (#42)
  - Read files
    inside the panel.
  - lib: New API.
- lib: **Export a helper.** (#43)

### Fixed

- Old one-line entry (#40)`;

it('preserves nested Markdown in release notes and reads wrapped details and old entries', () => {
  const raw = parse('## Unreleased\n\n' + body).sections[0]!.categories.Added[0]!;
  expect(entryParts(raw).details).toEqual(['Read files inside the panel.', 'lib: New API.']);
  const notes = execFileSync(process.execPath, ['scripts/release.mjs', 'notes', '3.4.0'], { encoding: 'utf8' });
  expect(notes).toContain('  - lib: In `genaicode/react`');
  expect(notes).toContain('The new window layout');
  expect(notes).not.toContain('### Internal');
});

it('requires a short bold title and PR number in Unreleased while accepting published legacy notes', () => {
  const validate = (line: string) => titleErrors(parse('## Unreleased\n### Fixed\n' + line + '\n## 3.0.0 — 2026-11-25\n' + body));
  expect(validate('- lib: **Export a helper.** (#43)\n  - API details')).toEqual([]);
  for (const line of ['- Old style (#1)', '- **Missing number.**', '- **' + 'x'.repeat(101) + '** (#1)'])
    expect(validate(line)).toHaveLength(1);
});

it('puts highlights first, groups user titles and keeps only app details in a closed disclosure', () => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<ReleaseNotes notes={'## 3.4.0 — 2026-11-25\n' + body} />);
  expect(host.querySelector('p')?.textContent).toBe('Window highlights.');
  expect([...host.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['New', 'Fixed']);
  expect(host.querySelector('details')?.open).toBe(false);
  expect(host.querySelector('summary')?.textContent).toBe('More');
  expect(host.querySelector('details li')?.textContent).toContain('Read files inside the panel.');
  expect(host.textContent).toContain('Old one-line entry');
  expect(host.textContent).not.toMatch(/new API|export a helper/i);
});
