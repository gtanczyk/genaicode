import { entryParts, parse } from '../../../scripts/changelog.mjs';
import { Markdown } from '../../react/markdown.js';

function appEntry(raw: string) {
  const { title, library, details, legacy } = entryParts(raw);
  if (library) return [];
  if (title) return [{ title, details: details.filter((detail) => !detail.startsWith('lib: ')) }];
  // Older releases only have a paragraph. Keep its full wording available on expansion.
  const text = legacy.replace(/ \(#\d+\)$/, '');
  if (text.length <= 100) return [{ title: text, details: [] }];
  const short = text.slice(0, 97).replace(/\s+\S*$/, '');
  return [{ title: short + '…', details: [text] }];
}

export function ReleaseNotes({ notes }: { notes: string }) {
  const sections = parse(notes).sections;
  return sections.map(({ version, intro, categories }) => {
    const groups = [
      { label: 'New', entries: [...categories.Breaking, ...categories.Added].flatMap(appEntry) },
      { label: 'Fixed', entries: categories.Fixed.flatMap(appEntry) },
    ];
    return <section key={version}>
      {sections.length > 1 && <h3>Version {version}</h3>}
      {intro.length > 0 && <Markdown text={intro.join('\n')} />}
      {groups.map(({ label, entries }) => entries.length > 0 && <section key={label}>
        <h3>{label}</h3>
        <ul className="release-entries">{entries.map(({ title, details }, i) => <li key={i}>
          <Markdown text={title}/>
          {details.length > 0 && <details>
            <summary aria-label={`More about ${title}`}>More</summary>
            <ul>{details.map((detail, i) => <li key={i}><Markdown text={detail}/></li>)}</ul>
          </details>}
        </li>)}</ul>
      </section>)}
    </section>;
  });
}
