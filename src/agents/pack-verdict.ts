import type { PackTaskChecks } from './pack-checks.js';

/**
 * A review that stands in the way of a merge: one on the current revision that failed, whose notes
 * have a line that starts with BLOCKER, or whose last verdict line asks for changes (the reviewer is
 * asked to end with `VERDICT: LGTM` or `VERDICT: CHANGES REQUESTED`). Quoted lines (`> …`), such as
 * an earlier round's findings, are not this review's.
 */
export function reviewBlocker(checks: PackTaskChecks | undefined): boolean {
  const review = checks?.review;
  if (!review || review.status === 'running' || review.revision !== checks.revision) return false;
  if (review.status === 'failed') return true;
  const own = (review.detail ?? '').split('\n').filter((line) => !/^\s*>/.test(line));
  if (own.some((line) => /^[\s*_#\-\d.)]*BLOCKER\b/.test(line))) return true;
  const verdict = [...own].reverse().find((line) => /^[\s*_#]*VERDICT\s*:/i.test(line));
  // One class between the colon and the words: no two runs that could match the same spaces.
  return !!verdict && /VERDICT\s*:[\s*_]*(?:CHANGES REQUESTED|REQUEST CHANGES|BLOCK)/i.test(verdict);
}

/** Fenced code: an opening line of three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * The verdict line of a reply ("VERDICT: LGTM"): its last line that starts with "verdict", outside
 * quotations, fenced code and indented code, so a quoted or sample verdict is not taken for the
 * reply's own. Read from the whole reply, before it is clipped for the report.
 */
export function replyVerdict(text: string): string | undefined {
  let fence: string | undefined;
  let verdict: string | undefined;
  for (const line of text.split('\n')) {
    const open = FENCE.exec(line);
    if (fence) {
      if (open && open[1]![0] === fence[0] && open[1]!.length >= fence.length && !line.slice(open[0].length).trim())
        fence = undefined;
      continue;
    }
    if (open) {
      fence = open[1];
      continue;
    }
    if (/^( {4}|\t)/.test(line) || /^\s*>/.test(line)) continue;
    if (/^[\W_]*verdict\b/i.test(line.trim())) verdict = line.trim();
  }
  return verdict && verdict.length > 200 ? `${verdict.slice(0, 199)}…` : verdict;
}

/** The two successful checks required before merging a group without opening each task. */
export function checkedForMerge(checks?: PackTaskChecks): boolean {
  if (
    !checks?.revision ||
    checks.verify?.status !== 'completed' ||
    checks.verify.revision !== checks.revision ||
    checks.review?.status !== 'completed' ||
    checks.review.revision !== checks.revision ||
    reviewBlocker(checks)
  )
    return false;
  if (checks.review.passed !== undefined) return checks.review.passed;
  const verdict = replyVerdict(checks.review.detail ?? '');
  return isPassingVerdict(verdict);
}

export function isPassingVerdict(verdict?: string): boolean {
  return !!verdict && /^[*_]*VERDICT\s*:[\s*_]*LGTM(?:\s*\(no blockers\))?[.!*_]*$/i.test(verdict);
}
