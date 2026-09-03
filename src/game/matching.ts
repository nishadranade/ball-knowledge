/**
 * Fuzzy player-name matching.
 *
 * Requirements:
 *  - Last name alone is enough to count as correct.
 *  - Minor typos are forgiven (player surnames are often hard to spell).
 *  - Diacritics are optional ("Ozil" matches "Özil", "Rosler" matches "Rösler").
 *
 * A guess matches a candidate if, after normalization, it equals or is within a
 * length-scaled edit distance of ANY acceptable token for that candidate
 * (full name, last name, or an alias).
 */

import { distance } from 'fastest-levenshtein';
import type { Player } from './types';

/** Special Latin letters that NFD does NOT decompose to ASCII + combining marks,
 *  so we transliterate them explicitly (e.g. German ß → ss: "Groß" ↔ "Gross"). */
const SPECIAL_LETTERS: Array<[RegExp, string]> = [
  [/ß/gi, 'ss'], // also uppercase ẞ (U+1E9E)
  [/æ/gi, 'ae'],
  [/œ/gi, 'oe'],
  [/ø/gi, 'o'],
  [/ł/gi, 'l'],
  [/đ/gi, 'd'],
  [/ð/gi, 'd'],
  [/þ/gi, 'th'],
  [/ı/g, 'i'], // dotless i (Turkish)
];

/** Lowercase, transliterate special letters, strip diacritics, drop punctuation,
 *  collapse whitespace. */
export function normalize(input: string): string {
  let s = input;
  for (const [re, rep] of SPECIAL_LETTERS) s = s.replace(re, rep);
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining marks (accents)
    .replace(/[.'`’\-]/g, ' ') // punctuation → space (O'Neil, Xhaka-style)
    .replace(/[^a-z0-9\s]/gi, ' ') // any other symbol → space
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Edit-distance budget for a token: longer tokens tolerate more typos. */
export function typoBudget(tokenLen: number): number {
  if (tokenLen <= 3) return 0; // too short to fuzz safely (e.g. "Xhaka" surname stems)
  if (tokenLen <= 5) return 1;
  if (tokenLen <= 9) return 2;
  return 3;
}

/** Build the set of normalized acceptable tokens for a candidate. */
export function acceptableTokens(player: Player): string[] {
  const tokens = new Set<string>();
  const full = normalize(player.fullName);
  if (full) tokens.add(full);
  const last = normalize(player.lastName);
  if (last) tokens.add(last);
  // See Player.noAutoTokens: club answers opt out, since "the first/last word
  // of the full name" is ambiguous across clubs in a way it rarely is for people.
  if (!player.noAutoTokens) {
    const parts = full.split(' ');
    if (parts.length > 1) {
      // The last whitespace token of the full name (covers multi-word surnames loosely).
      tokens.add(parts[parts.length - 1]);
      // The first name, for players commonly known by it (Vinícius, Alisson) —
      // their stored surname ("Júnior", "Becker") is often not what anyone says.
      // Guarded at 3+ chars, which also keeps surname particles ("El Hadji Diouf")
      // and initials from becoming answers on their own.
      if (parts[0].length >= 3) tokens.add(parts[0]);
    }
  }
  for (const alias of player.aliases ?? []) {
    const a = normalize(alias);
    if (a) tokens.add(a);
  }
  return [...tokens];
}

export interface MatchResult<T extends Player> {
  candidate: T;
  token: string;
  editDistance: number;
}

/**
 * Return the best matching candidate for a guess, or null.
 * "Best" = smallest edit distance to any acceptable token (exact = 0 wins).
 */
export function matchAnswer<T extends Player>(
  guess: string,
  candidates: T[],
): MatchResult<T> | null {
  const g = normalize(guess);
  if (!g) return null;

  let best: MatchResult<T> | null = null;
  for (const candidate of candidates) {
    for (const token of acceptableTokens(candidate)) {
      const budget = typoBudget(token.length);
      // Guard: don't let a short guess fuzzily swallow a long token (or vice
      // versa). Require lengths to be within budget+1 of each other.
      if (Math.abs(token.length - g.length) > budget + 1) continue;
      const d = distance(g, token);
      if (d <= budget) {
        if (!best || d < best.editDistance) {
          best = { candidate, token, editDistance: d };
          if (d === 0) return best; // can't do better than exact
        }
      }
    }
  }
  return best;
}

/** Convenience boolean check against a single player. */
export function isMatch(guess: string, player: Player): boolean {
  return matchAnswer(guess, [player]) !== null;
}
