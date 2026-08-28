/**
 * Subsequence fuzzy matcher (zero-dependency, deterministic).
 *
 * Scoring: +1 per matched char, +5 for a consecutive run (so a solid run
 * beats scattered single-char word hits), +4 at a word/segment start
 * (after whitespace, `>`, `-`, `—`, `_`, `/`, `#`), plus small bonuses for
 * early and tight matches. Returns null when the query is not a
 * subsequence of the text.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 0;

  let ti = 0;
  let score = 0;
  let prevMatch = -2;
  let firstMatch = -1;

  for (const ch of q) {
    if (ch === " ") continue;
    let found = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] === ch) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;
    if (firstMatch === -1) firstMatch = found;

    score += 1;
    if (found === prevMatch + 1) score += 5;
    if (found === 0 || /[\s>\-—_/#]/.test(t[found - 1])) score += 4;

    prevMatch = found;
    ti = found + 1;
  }

  // Earlier first match ranks higher.
  score += Math.max(0, 4 - firstMatch / 4);
  // On near-ties prefer the shorter (more specific) target.
  score += Math.max(0, 4 - (t.length - q.length) / 32);

  return score;
}

export interface SearchEntry<T> {
  item: T;
  /** The string scored against — typically a breadcrumb label. */
  label: string;
}

/** Rank items by fuzzy score against `query`, best first, capped at `limit`. */
export function rankSearch<T>(
  query: string,
  entries: SearchEntry<T>[],
  limit = 8,
): T[] {
  return entries
    .map((entry) => ({ entry, score: fuzzyScore(query, entry.label) }))
    .filter((r): r is { entry: SearchEntry<T>; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.entry.item);
}
