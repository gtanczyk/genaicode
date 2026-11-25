export const CATEGORIES = ['Breaking', 'Added', 'Fixed', 'Internal'];
export const UNRELEASED = 'Unreleased';

const SECTION_RE = /^## (Unreleased|(\d+)\.(\d+)\.(\d+))(?:\s+[—-]\s+(\d{4}-\d{2}-\d{2}))?\s*$/;
const CATEGORY_RE = /^### (\w+)\s*$/;
const ENTRY_RE = /^- (.+)$/;

export function parse(text) {
  const lines = text.split('\n');
  const sections = [];
  const errors = [];
  let section = null;
  let category = null;
  lines.forEach((line, index) => {
    const at = index + 1;
    const head = SECTION_RE.exec(line);
    if (head) {
      if (section) section.end = index;
      section = {
        version: head[1],
        date: head[5] ?? null,
        categories: Object.fromEntries(CATEGORIES.map((c) => [c, []])),
        intro: [],
        start: index,
        end: lines.length,
      };
      sections.push(section);
      category = null;
      return;
    }
    if (line.startsWith('## '))
      return void errors.push(`${at}: malformed section "${line}" (want "## Unreleased" or "## 1.2.3 — YYYY-MM-DD")`);
    const cat = CATEGORY_RE.exec(line);
    if (cat) {
      if (!section) return void errors.push(`${at}: category before any "## " section`);
      if (!CATEGORIES.includes(cat[1])) {
        category = null;
        return void errors.push(`${at}: unknown category "${cat[1]}" (want ${CATEGORIES.join(' | ')})`);
      }
      category = cat[1];
      return;
    }
    const entry = ENTRY_RE.exec(line);
    if (entry && section) {
      if (!category) return void errors.push(`${at}: entry outside a "### Category" in ${section.version}`);
      section.categories[category].push(entry[1].trim());
      return;
    }
    if (/^\s+\S/.test(line) && section && category) {
      const list = section.categories[category];
      if (!list.length) return void errors.push(`${at}: detail without an entry`);
      list[list.length - 1] += `\n${line}`;
      return;
    }
    // Prose between a version's heading and its first category opens the release notes.
    if (section && !category && (line.trim() || section.intro.length)) section.intro.push(line);
  });
  const unreleased = sections.filter((s) => s.version === UNRELEASED);
  if (unreleased.length !== 1)
    errors.push(unreleased.length ? 'more than one "## Unreleased" section' : 'missing "## Unreleased" section');
  const seen = new Set();
  for (const s of sections) {
    if (s.version === UNRELEASED) continue;
    if (seen.has(s.version)) errors.push(`version ${s.version} appears twice`);
    seen.add(s.version);
    if (!s.date) errors.push(`section ${s.version} has no date`);
  }
  return { sections, errors, lines };
}

// Keep the original Markdown for GitHub. Interpret titles and audience only for validation and the app.
export function entryParts(raw) {
  const [heading, ...body] = raw.split('\n');
  const match = /^(lib: )?\*\*(.+?)\*\* \(#(\d+)\)$/.exec(heading);
  const title = match?.[2];
  const details = [];
  let legacy = heading;
  for (const line of body) {
    const bullet = /^\s+- (.+)/.exec(line);
    if (bullet) details.push(bullet[1]);
    else if (details.length) details[details.length - 1] += ' ' + line.trim();
    else legacy += ' ' + line.trim();
  }
  return { title, library: !!match?.[1], details, legacy };
}

export function titleErrors(parsed) {
  const section = parsed.sections.find((one) => one.version === UNRELEASED);
  return Object.values(section?.categories ?? {}).flat().flatMap((raw) => {
    const { title, legacy } = entryParts(raw);
    if (!title?.trim() || legacy !== raw.split('\n')[0] || [...title].length > 100)
      return [`Unreleased needs a bold title of 1–100 characters and a PR number: ${raw.split('\n')[0]}`];
    return [];
  });
}
