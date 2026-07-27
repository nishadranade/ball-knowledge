/**
 * Daily challenge logic (Wordle-style): pick the same questions for everyone on
 * a given day, seeded only by the UTC date — no backend. Also builds the
 * spoiler-free share text.
 *
 * The daily is 2 questions: one LIST + one CAREER_PATH. Selection is fixed by
 * the date (ignores the user's practice-mode filters), so every visitor gets
 * an identical daily.
 */

import type { Question, ListQuestion, CareerPathQuestion } from './types';

/** Launch epoch (UTC midnight) — day 1 of "Footy Quiz #N". */
const EPOCH_UTC = Date.UTC(2026, 0, 1); // 2026-01-01
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** UTC date key "YYYY-MM-DD" for a given Date (defaults to now). */
export function dateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Day number since launch epoch (1-based) → the "#N" in the share header. */
export function dayNumber(now: Date = new Date()): number {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((todayUtc - EPOCH_UTC) / MS_PER_DAY) + 1;
}

/** Deterministic 32-bit hash of a string (FNV-1a). Stable across sessions/browsers. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // unsigned
}

export interface DailySelection {
  list: ListQuestion | null;
  career: CareerPathQuestion | null;
}

/**
 * Pick the day's questions from the full pool, seeded by the date key. Uses
 * different salts for the two slots so they don't move in lockstep. Returns
 * null for a slot if the pool has none of that format.
 */
export function selectDaily(all: Question[], key: string = dateKey()): DailySelection {
  const lists = all.filter((q): q is ListQuestion => q.format === 'LIST');
  const careers = all.filter((q): q is CareerPathQuestion => q.format === 'CAREER_PATH');
  const pick = <T>(pool: T[], salt: string): T | null =>
    pool.length ? pool[hashString(key + salt) % pool.length] : null;
  return {
    list: pick(lists, ':list'),
    career: pick(careers, ':career'),
  };
}

/** Per-question outcome captured when a round ends. */
export interface RoundResult {
  format: 'LIST' | 'CAREER_PATH';
  found: number; // answers found (1 or 0 for career)
  total: number; // total answers (1 for career)
  wrong: number; // wrong guesses used
  maxWrong: number;
  won: boolean;
}

export interface DailyResult {
  day: number;
  results: RoundResult[];
}

/** Build the spoiler-free share text (no player names). */
export function buildShareText(result: DailyResult, url = 'nishadranade.github.io/footy-quiz'): string {
  const lines = [`⚽ Footy Quiz #${result.day}`];
  for (const r of result.results) {
    if (r.format === 'LIST') {
      // One square per answer slot: 🟩 found, 🟥 missed.
      const grid = '🟩'.repeat(r.found) + '🟥'.repeat(Math.max(0, r.total - r.found));
      lines.push(`List:   ${grid} ${r.found}/${r.total}`);
    } else {
      const mark = r.won ? '🟩' : '🟥';
      const guesses = r.won ? `${r.wrong + 1} guess${r.wrong === 0 ? '' : 'es'}` : 'missed';
      lines.push(`Career: ${mark} (${guesses})`);
    }
  }
  lines.push(url);
  return lines.join('\n');
}
