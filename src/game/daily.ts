/**
 * Daily challenge logic (Wordle-style): pick the same questions for everyone on
 * a given day, seeded only by the calendar date — no backend. Also builds the
 * spoiler-free share text.
 *
 * The daily is 2 questions: one LIST + one CAREER_PATH. Selection is fixed by
 * the date (ignores the user's practice-mode filters), so every visitor gets
 * an identical daily. The "day" is **US Pacific** (America/Los_Angeles), so the
 * puzzle rolls over at Pacific midnight regardless of the visitor's own
 * timezone (DST handled automatically by Intl).
 */

import type { Question, ListQuestion, CareerPathQuestion } from './types';

const TIME_ZONE = 'America/Los_Angeles';
/** Launch epoch (Pacific) — the date that is day 1 of "Ball Knowledge #N". */
const EPOCH_KEY = '2026-07-28';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Calendar date key "YYYY-MM-DD" in US Pacific time for a given instant. */
export function dateKey(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD; timeZone shifts the instant to Pacific first.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Whole days between two "YYYY-MM-DD" keys (b - a), timezone-agnostic. */
function daysBetween(aKey: string, bKey: string): number {
  const a = Date.UTC(+aKey.slice(0, 4), +aKey.slice(5, 7) - 1, +aKey.slice(8, 10));
  const b = Date.UTC(+bKey.slice(0, 4), +bKey.slice(5, 7) - 1, +bKey.slice(8, 10));
  return Math.round((b - a) / MS_PER_DAY);
}

/** Day number since launch epoch (1-based) → the "#N" in the share header. */
export function dayNumber(now: Date = new Date()): number {
  return daysBetween(EPOCH_KEY, dateKey(now)) + 1;
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
/** Max answers a daily LIST question shows — keeps the daily snappy. A top-10
 *  question is cut down to its top 5 (ties at the 5th value are kept, matching
 *  the generator's tie behavior), and its prompt's number is rewritten to match. */
const DAILY_LIST_SIZE = 5;

export function truncateDailyList(q: ListQuestion): ListQuestion {
  if (q.answers.length <= DAILY_LIST_SIZE) return q;
  const cutoff = q.answers[DAILY_LIST_SIZE - 1].value ?? 0;
  const answers = q.answers.filter((a, i) => i < DAILY_LIST_SIZE || (a.value ?? 0) >= cutoff);
  return {
    ...q,
    answers,
    prompt: q.prompt.replace(/\btop \d+\b/i, `top ${DAILY_LIST_SIZE}`),
  };
}

/** Daily career picks should be broadly recognizable. Accept a player if they're
 *  either VERY famous (best rank ≤ this) OR played recently (see YEAR floor) —
 *  so all-time legends (Henry, Gerrard) AND modern names both qualify, while
 *  older mid-tier players are trimmed. */
const DAILY_CAREER_FAME_RANK = 100;
const DAILY_CAREER_RECENT_YEAR = 2015;

/** Latest year a player was active, parsed from their career stints. An open
 *  range like "2023–" (still active) returns a large year so it always passes. */
export function latestCareerYear(q: CareerPathQuestion): number {
  let latest = 0;
  for (const stint of q.career) {
    const years = stint.years ?? '';
    if (/[–-]\s*$/.test(years.trim())) return 9999; // open-ended = currently active
    const nums = years.match(/\d{4}/g);
    if (nums) for (const n of nums) latest = Math.max(latest, Number(n));
  }
  return latest;
}

/** Whether a career question is "daily-appropriate": famous OR recent. */
export function isDailyCareer(q: CareerPathQuestion): boolean {
  const famous = q.bestRank != null && q.bestRank <= DAILY_CAREER_FAME_RANK;
  const recent = latestCareerYear(q) >= DAILY_CAREER_RECENT_YEAR;
  return famous || recent;
}

export function selectDaily(all: Question[], key: string = dateKey()): DailySelection {
  // The daily is Standard-only so everyone's shared challenge stays approachable
  // (famous clubs/countries/players — no obscure Hard slices).
  const standard = all.filter((q) => q.difficulty === 'STANDARD');
  const lists = standard.filter((q): q is ListQuestion => q.format === 'LIST');
  let careers = standard.filter((q): q is CareerPathQuestion => q.format === 'CAREER_PATH');
  // Prefer daily-appropriate (famous OR recent) career players; fall back to the
  // full Standard set only if the filter somehow leaves nothing (safety net).
  const dailyCareers = careers.filter(isDailyCareer);
  if (dailyCareers.length) careers = dailyCareers;
  const pick = <T>(pool: T[], salt: string): T | null =>
    pool.length ? pool[hashString(key + salt) % pool.length] : null;
  const list = pick(lists, ':list');
  return {
    list: list ? truncateDailyList(list) : null,
    career: pick(careers, ':career'),
  };
}

/**
 * A frozen daily schedule: date → the exact questions for that day, stored as
 * FULL question objects so a day, once frozen, is immune to any later change in
 * questions.json. Written at build time (past + today), committed, and served as
 * public/data/daily.json. See scripts/build-daily.ts.
 */
export interface DailySchedule {
  [dateKey: string]: { list: ListQuestion | null; career: CareerPathQuestion | null };
}

/**
 * Resolve the day's questions: use the frozen schedule entry if present (so
 * data updates can never change a past/frozen daily), otherwise fall back to
 * hashing the live pool (dev, or a day not yet frozen into the schedule).
 */
export function resolveDaily(
  all: Question[],
  schedule: DailySchedule | null,
  key: string = dateKey(),
): DailySelection {
  const frozen = schedule?.[key];
  if (frozen) return { list: frozen.list, career: frozen.career };
  return selectDaily(all, key);
}

/** Per-question outcome captured when a round ends. */
export interface RoundResult {
  format: 'LIST' | 'CAREER_PATH';
  found: number; // answers found (1 or 0 for career)
  total: number; // total answers (1 for career)
  wrong: number; // wrong guesses used
  maxWrong: number;
  won: boolean;
  /** LIST only: per-slot found/missed in answer (rank) order — true = found. */
  slots?: boolean[];
}

export interface DailyResult {
  day: number;
  results: RoundResult[];
}

/** Build the spoiler-free share text (no player names). Formatted to read well
 *  in any app (no monospace alignment): header, blank line, one line per
 *  question, blank line, URL. */
export function buildShareText(result: DailyResult, url = 'nishadranade.github.io/ball-knowledge'): string {
  const rows = result.results.map((r) => {
    if (r.format === 'LIST') {
      // One square per answer slot IN RANK ORDER: 🟩 found, 🟥 missed. Fall back
      // to count-based (all found first) if slot order wasn't captured.
      const grid = r.slots
        ? r.slots.map((f) => (f ? '🟩' : '🟥')).join('')
        : '🟩'.repeat(r.found) + '🟥'.repeat(Math.max(0, r.total - r.found));
      return `📋 List: ${grid} (${r.found}/${r.total})`;
    }
    // Career: one 🟥 per wrong guess, then 🟩 if solved — the guess sequence.
    // e.g. first try → 🟩; second try → 🟥🟩; missed → 🟥🟥.
    const grid = '🟥'.repeat(r.wrong) + (r.won ? '🟩' : '');
    const guesses = r.won ? `${r.wrong + 1} guess${r.wrong === 0 ? '' : 'es'}` : 'missed';
    return `👤 Career: ${grid} (${guesses})`;
  });
  return [`⚽ Ball Knowledge #${result.day}`, '', ...rows, '', url].join('\n');
}
