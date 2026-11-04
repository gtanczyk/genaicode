// Release plumbing driven by CHANGELOG.md: its Unreleased categories decide the next version.
//
//   node scripts/release.mjs next                     next version, or "none"
//   node scripts/release.mjs cut [--date YYYY-MM-DD]  move Unreleased under that version, bump package.json + lock
//   node scripts/release.mjs notes 1.2.3              print that version's notes (Internal left out)
//   node scripts/release.mjs check [--files a,b]      changelog well formed, its newest version = package.json;
//                                          with --files, a shipped-code change must touch CHANGELOG.md
//
// The auto-opened release PR runs `cut`; merging it is the cutoff, and publish.yaml publishes.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = 'CHANGELOG.md';
// Paths that ship in the package: a change there must add a changelog line (tests excluded).
const SHIPPED = ['src/'];
const CATEGORIES = ['Breaking', 'Added', 'Fixed', 'Internal'];
const UNRELEASED = 'Unreleased';

const SECTION_RE = /^## (Unreleased|(\d+)\.(\d+)\.(\d+))(?:\s+[—-]\s+(\d{4}-\d{2}-\d{2}))?\s*$/;
const CATEGORY_RE = /^### (\w+)\s*$/;
const ENTRY_RE = /^- (.+)$/;

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const write = (file, text) => fs.writeFileSync(path.join(ROOT, file), text);
const packageVersion = () => JSON.parse(read('package.json')).version;

export function shippedTouched(files) {
  return files.some(
    (file) => SHIPPED.some((prefix) => file.startsWith(prefix)) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file),
  );
}

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
      if (list.length) list[list.length - 1] += ` ${line.trim()}`;
    }
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

const unreleased = (parsed) => parsed.sections.find((s) => s.version === UNRELEASED);
const latest = (parsed) => parsed.sections.find((s) => s.version !== UNRELEASED)?.version ?? null;

// The highest category present decides; Internal alone never releases. Before 1.0 a breaking change bumps minor.
export function nextVersion(current, section) {
  const c = section?.categories;
  const kind = !c ? null : c.Breaking.length ? 'major' : c.Added.length ? 'minor' : c.Fixed.length ? 'patch' : null;
  if (!kind) return null;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) throw new Error(`package.json version "${current}" is not x.y.z`);
  let [major, minor, patch] = m.slice(1).map(Number);
  const effective = kind === 'major' && major === 0 ? 'minor' : kind;
  if (effective === 'major') [major, minor, patch] = [major + 1, 0, 0];
  else if (effective === 'minor') [minor, patch] = [minor + 1, 0];
  else patch += 1;
  return `${major}.${minor}.${patch}`;
}

function render(section, includeInternal) {
  const out = [];
  for (const name of CATEGORIES) {
    if (name === 'Internal' && !includeInternal) continue;
    if (!section.categories[name].length) continue;
    out.push(`### ${name}`, '', ...section.categories[name].map((e) => `- ${e}`), '');
  }
  return out;
}

export function cut(text, version, date) {
  const parsed = parse(text);
  if (parsed.errors.length) throw new Error(parsed.errors.join('\n'));
  const section = unreleased(parsed);
  const released = [`## ${UNRELEASED}`, '', `## ${version} — ${date}`, '', ...render(section, true)];
  return [...parsed.lines.slice(0, section.start), ...released, ...parsed.lines.slice(section.end)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

export function notes(text, version) {
  const parsed = parse(text);
  const section = parsed.sections.find((s) => s.version === version);
  if (!section) return null;
  const body = render(section, false);
  if (body.length) return body.join('\n').trim();
  return (
    parsed.lines
      .slice(section.start + 1, section.end)
      .join('\n')
      .trim() || null
  );
}

function baseChangelog(ref) {
  try {
    return execFileSync('git', ['show', `${ref}:${CHANGELOG}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function computeNext() {
  const parsed = parse(read(CHANGELOG));
  if (parsed.errors.length) throw new Error(`${CHANGELOG}: ${parsed.errors.join('; ')}`);
  const version = nextVersion(packageVersion(), unreleased(parsed));
  // A number npm already holds (an accidental publish, an unpublished one) can never be published again:
  // step past it by patch, so the release PR always proposes a version that will publish.
  const used = taken();
  let next = version;
  while (next && used.has(next)) next = next.replace(/\d+$/, (n) => String(Number(n) + 1));
  return next;
}

function taken() {
  try {
    const name = JSON.parse(read('package.json')).name;
    const out = execFileSync('npm', ['view', name, 'versions', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return new Set([JSON.parse(out)].flat());
  } catch {
    return new Set();
  }
}

function check(files, base) {
  const parsed = parse(read(CHANGELOG));
  if (parsed.errors.length) {
    console.error(`${CHANGELOG} is malformed:\n${parsed.errors.map((e) => `  ${e}`).join('\n')}`);
    return 1;
  }
  const newest = latest(parsed);
  if (newest !== packageVersion()) {
    console.error(
      `version drift: ${CHANGELOG} says ${newest ?? 'nothing released'}, package.json says ${packageVersion()}. Bump versions only through the release PR (release.mjs cut).`,
    );
    return 1;
  }
  if (!files) {
    console.log(`${CHANGELOG}: OK (${newest})`);
    return 0;
  }
  if (!shippedTouched(files)) {
    console.log(`${CHANGELOG}: no shipped change in this diff`);
    return 0;
  }
  // A line this change added under Unreleased: compared with the base branch's changelog when given,
  // so editing old notes or the intro does not count.
  const entries = (section) => (section ? CATEGORIES.flatMap((c) => section.categories[c]) : []);
  const before = new Set(base === null ? [] : entries(unreleased(parse(base))));
  const added = entries(unreleased(parsed)).filter((e) => !before.has(e));
  if (files.includes(CHANGELOG) && added.length) {
    console.log(`${CHANGELOG}: Unreleased gained ${added.length} line(s)`);
    return 0;
  }
  console.error(
    `This change touches shipped code (${SHIPPED.join(', ')}) but adds no line under "## Unreleased" in ${CHANGELOG}.\nAdd one in ### Added, ### Fixed, ### Breaking, or ### Internal (no release).`,
  );
  return 1;
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const option = (name) => (rest.includes(`--${name}`) ? (rest[rest.indexOf(`--${name}`) + 1] ?? '') : null);
  if (command === 'next') return console.log(computeNext() ?? 'none');
  if (command === 'cut') {
    const version = computeNext();
    if (!version) {
      console.error('Nothing to cut: Unreleased has no Breaking/Added/Fixed entries.');
      return void (process.exitCode = 1);
    }
    write(CHANGELOG, cut(read(CHANGELOG), version, option('date') ?? new Date().toISOString().slice(0, 10)));
    execFileSync('npm', ['version', version, '--no-git-tag-version', '--ignore-scripts'], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    return console.log(version);
  }
  if (command === 'notes') {
    const text = rest[0] && notes(read(CHANGELOG), rest[0]);
    if (!text) {
      console.error(`No ${CHANGELOG} section for ${rest[0] ?? '(no version given)'}.`);
      return void (process.exitCode = 1);
    }
    return console.log(text);
  }
  if (command === 'check') {
    const files = option('files');
    const baseRef = option('base');
    // A base without a changelog yet (the change that adds it) counts as an empty one.
    const base = baseRef ? baseChangelog(baseRef) : null;
    return void (process.exitCode = check(
      files === null
        ? null
        : files
            .split(/[,\n]/)
            .map((f) => f.trim())
            .filter(Boolean),
      base,
    ));
  }
  console.error('usage: release.mjs next | cut [--date YYYY-MM-DD] | notes <version> | check [--files a,b]');
  process.exitCode = 2;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
