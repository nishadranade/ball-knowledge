/**
 * Daily challenge logic (Wordle-style): pick the same questions for everyone on
 * a given day, seeded only by the calendar date — no backend. Also builds the
 * spoiler-free share text.
 *
 * The daily is 3 questions: one LIST + two CAREER_PATHs. Selection is fixed by
 * the date (ignores the user's practice-mode filters), so every visitor gets
 * an identical daily. The "day" is **US Pacific** (America/Los_Angeles), so the
 * puzzle rolls over at Pacific midnight regardless of the visitor's own
 * timezone (DST handled automatically by Intl).
 */

import type { Question, ListQuestion, CareerPathQuestion, MatchQuestion, SquadQuestion } from './types';

const TIME_ZONE = 'America/Los_Angeles';
/** Launch epoch (Pacific) — the date that is day 1 of "Ball Knowledge #N". */
const EPOCH_KEY = '2026-07-28';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How many previous days a question is excluded from repeating in, per
 *  format (see `recentlyUsedIds`). Pool sizes comfortably support this —
 *  even the smallest STANDARD pool (list, ~156) leaves well over 100 choices
 *  after a month is excluded. */
const REPEAT_COOLDOWN_DAYS = 30;

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

/** "YYYY-MM-DD" `days` before `key` — same UTC-anchored parsing as daysBetween. */
function daysBefore(key: string, days: number): string {
  const d = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
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
  /** Second career path. OPTIONAL on purpose: days frozen before the daily grew
   *  to three questions have no `career2`, and must keep rendering as the
   *  two-question round they were actually played as. */
  career2?: CareerPathQuestion | null;
  /** Match question. OPTIONAL for the same reason — days frozen before the match
   *  format existed have no `match` and stay at whatever length they were. */
  match?: MatchQuestion | null;
  /** Starting-XI question. OPTIONAL for the same reason — days frozen before
   *  2026-08-20 (when SQUAD joined the daily) have no `squad` and stay at
   *  whatever length they were. */
  squad?: SquadQuestion | null;
}

/**
 * Pick the day's questions from the full pool, seeded by the date key. Uses
 * different salts for the three slots so they don't move in lockstep. Returns
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

/**
 * A match and a squad question are near-guaranteed to share a fixture — 98.5%
 * of the STANDARD squad pool is drawn from a fixture that ALSO has a STANDARD
 * match question, since both come from the same qualifying-fixture filter.
 * Ids don't reveal that (`match_..._arsenal_chelsea` vs
 * `squad_..._arsenal_chelsea_home` are different strings), so the collision
 * has to be checked on the underlying game, not the id.
 */
function fixtureKeyOf(q: MatchQuestion | SquadQuestion): string {
  if (q.format === 'MATCH') return `${q.match.date}_${q.match.homeTeam}_${q.match.awayTeam}`;
  const home = q.squad.home ? q.squad.team : q.squad.opponent;
  const away = q.squad.home ? q.squad.opponent : q.squad.team;
  return `${q.squad.date}_${home}_${away}`;
}

/** Drop any pool member whose id is in `excludeIds` — but never let that
 *  leave a slot with nothing to draw from; the exclusion is a "prefer not
 *  to repeat" preference, not a hard requirement that could break a day. */
function excluding<T extends { id: string }>(pool: T[], excludeIds: ReadonlySet<string>): T[] {
  if (!excludeIds.size) return pool;
  const filtered = pool.filter((q) => !excludeIds.has(q.id));
  return filtered.length ? filtered : pool;
}

/**
 * Pick the day's questions from the full pool, seeded by the date key. Uses
 * different salts for each slot so they don't move in lockstep. Returns null
 * for a slot if the pool has none of that format.
 *
 * `excludeIds` — ids to skip if at all possible, e.g. questions used on
 * recent days (see `recentlyUsedIds`). Pure and optional so `selectDaily` on
 * its own is still a plain hash of the date, easy to test and reason about;
 * the recency behavior is layered on by the caller (`resolveDaily`,
 * `build-daily.ts`), not hidden inside this function.
 */
export function selectDaily(
  all: Question[],
  key: string = dateKey(),
  excludeIds: ReadonlySet<string> = new Set(),
): DailySelection {
  // The daily is Standard-only so everyone's shared challenge stays approachable
  // (famous clubs/countries/players — no obscure Hard slices).
  const standard = all.filter((q) => q.difficulty === 'STANDARD');
  const lists = excluding(
    standard.filter((q): q is ListQuestion => q.format === 'LIST'),
    excludeIds,
  );
  let careers = standard.filter((q): q is CareerPathQuestion => q.format === 'CAREER_PATH');
  // Prefer daily-appropriate (famous OR recent) career players; fall back to the
  // full Standard set only if the filter somehow leaves nothing (safety net).
  const dailyCareers = careers.filter(isDailyCareer);
  if (dailyCareers.length) careers = dailyCareers;
  careers = excluding(careers, excludeIds);
  const pick = <T>(pool: T[], salt: string): T | null =>
    pool.length ? pool[hashString(key + salt) % pool.length] : null;
  const list = pick(lists, ':list');
  // Two career paths per day. The second is drawn from the pool MINUS the first,
  // so a day can never ask the same player twice. Note the ':list' and ':career'
  // draws are untouched by this — a day's list and first career resolve to
  // exactly what they did when the daily was two questions.
  const career = pick(careers, ':career');
  const career2 = pick(
    careers.filter((q) => q.id !== career?.id),
    ':career2',
  );
  // One match question per day. Its own salt, so adding it left every existing
  // slot's draw untouched.
  const matches = excluding(
    standard.filter((q): q is MatchQuestion => q.format === 'MATCH'),
    excludeIds,
  );
  const match = pick(matches, ':match');
  // One squad (starting XI) question per day, same pattern — its own salt, so
  // adding it left every existing slot's draw untouched. Additionally excludes
  // whichever fixture `match` landed on, so the day can't ask "who scored"
  // and "name the XI" about the exact same game (see fixtureKeyOf above).
  let squads = excluding(
    standard.filter((q): q is SquadQuestion => q.format === 'SQUAD'),
    excludeIds,
  );
  if (match) {
    const matchFixture = fixtureKeyOf(match);
    const withoutMatchFixture = squads.filter((q) => fixtureKeyOf(q) !== matchFixture);
    if (withoutMatchFixture.length) squads = withoutMatchFixture;
  }
  const squad = pick(squads, ':squad');
  return {
    list: list ? truncateDailyList(list) : null,
    career,
    career2,
    match,
    squad,
  };
}

/**
 * Ids used anywhere in the `cooldownDays` before `key` (every slot, not just
 * same-format — a repeated fixture across formats is just as repetitive to a
 * player as a literal repeated question). Only looks at what's already in
 * `schedule`, so it's just as safe to call from the browser (which has the
 * committed schedule) as from build-daily.ts (which is building it).
 */
export function recentlyUsedIds(
  schedule: DailySchedule | null,
  key: string = dateKey(),
  cooldownDays = REPEAT_COOLDOWN_DAYS,
): Set<string> {
  const used = new Set<string>();
  if (!schedule) return used;
  for (let i = 1; i <= cooldownDays; i++) {
    const entry = schedule[daysBefore(key, i)];
    if (!entry) continue;
    for (const q of [entry.list, entry.career, entry.career2, entry.match, entry.squad]) {
      if (q) used.add(q.id);
    }
  }
  return used;
}

/**
 * A frozen daily schedule: date → the exact questions for that day, stored as
 * FULL question objects so a day, once frozen, is immune to any later change in
 * questions.json. Written at build time (past + today), committed, and served as
 * public/data/daily.json. See scripts/build-daily.ts.
 */
export interface DailySchedule {
  [dateKey: string]: DailySelection;
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
  // `career2`, `match` and `squad` are absent on days frozen before those
  // slots existed; such a day keeps the length it was actually played at,
  // which is the whole point of freezing.
  if (frozen) {
    return {
      list: frozen.list,
      career: frozen.career,
      career2: frozen.career2 ?? null,
      match: frozen.match ?? null,
      squad: frozen.squad ?? null,
    };
  }
  // Avoid repeating a recently-frozen question, using the same schedule data
  // build-daily.ts will use when it actually freezes this day — so the live
  // preview a visitor sees before freezing matches what they'll get after.
  return selectDaily(all, key, recentlyUsedIds(schedule, key));
}

/** Per-question outcome captured when a round ends. */
export interface RoundResult {
  format: 'LIST' | 'CAREER_PATH' | 'MATCH' | 'SQUAD';
  found: number; // answers found (1 or 0 for career)
  total: number; // total answers (1 for career)
  wrong: number; // wrong guesses used
  maxWrong: number;
  won: boolean;
  /** LIST, MATCH and SQUAD: per-slot found/missed in answer order — true = found. */
  slots?: boolean[];
  /** Wall-clock time on this question, ms (mount → round end). Optional so old
   *  stored results / tests without timing still work. */
  elapsedMs?: number;
}

/** Format a duration as compact m:ss (e.g. 67000 → "1:07"). */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface DailyResult {
  day: number;
  results: RoundResult[];
}

/** Build the spoiler-free share text (no player names). Formatted to read well
 *  in any app (no monospace alignment): header, blank line, one line per
 *  question, blank line, URL. */
/** One spoiler-free result line for a single round (shared by daily + practice).
 *  e.g. "📋 List: 🟩🟥🟩🟥🟩 (3/5 · 1:07)", "👤 Career: 🟥🟩 (2 guesses · 0:24)",
 *  "⚽ Match: 🟩🟥🟩 (2/3 · 0:51)", or "👕 Squad: 🟩🟩🟥... (8/11 · 2:14)". */
export function formatRoundRow(r: RoundResult): string {
  const time = r.elapsedMs != null ? ` · ${formatDuration(r.elapsedMs)}` : '';
  /** One square per answer slot in answer order: 🟩 found, 🟥 missed. Falls back
   *  to count-based (all found first) if slot order wasn't captured. */
  const slotGrid = () =>
    r.slots
      ? r.slots.map((f) => (f ? '🟩' : '🟥')).join('')
      : '🟩'.repeat(r.found) + '🟥'.repeat(Math.max(0, r.total - r.found));
  if (r.format === 'LIST') {
    return `📋 List: ${slotGrid()} (${r.found}/${r.total}${time})`;
  }
  if (r.format === 'MATCH') {
    // Spoiler-free: which slots were filled, but never a name or the fixture.
    return `⚽ Match: ${slotGrid()} (${r.found}/${r.total}${time})`;
  }
  if (r.format === 'SQUAD') {
    return `👕 Squad: ${slotGrid()} (${r.found}/${r.total}${time})`;
  }
  // Career: one 🟥 per wrong guess, then 🟩 if solved — the guess sequence.
  // e.g. first try → 🟩; second try → 🟥🟩; missed → 🟥🟥.
  const grid = '🟥'.repeat(r.wrong) + (r.won ? '🟩' : '');
  const guesses = r.won ? `${r.wrong + 1} guess${r.wrong === 0 ? '' : 'es'}` : 'missed';
  return `👤 Career: ${grid} (${guesses}${time})`;
}

/**
 * Accuracy points a QUESTION is worth, regardless of format or slot count —
 * a 1-slot career and an 11-slot squad both max out at this. Scored by
 * completion fraction (found/total), not a flat amount per slot, precisely
 * so a 5-answer list can't outweigh a 1-answer career just for having more
 * slots: every round is an equal-sized share of the day.
 */
const POINTS_PER_QUESTION = 40;
/**
 * Perfect-round bonus, scaled to the question's OWN wrong-guess budget
 * (`maxWrong`) rather than a flat amount — a flawless squad round (6 lives)
 * is a bigger feat than a flawless career round (2 lives), and should be
 * worth more.
 */
const PERFECT_BONUS_PER_WRONG_BUDGET = 4;

/**
 * Speed bonus for the WHOLE day's total time: decays LINEARLY from
 * MAX_SPEED_BONUS at 0:00 to zero at ZERO_SPEED_BONUS_AT_MS, rather than
 * jumping between fixed tiers. Continuous on purpose — with discrete tiers,
 * a couple of seconds near a cutoff could swing the score by more than
 * acing an entire question, which is a worse failure mode than the speed
 * bonus mattering at all. Tuned for a 5-question daily that includes an
 * 11-name Starting XI round — retune again if the daily's length or format
 * mix changes a lot.
 */
const MAX_SPEED_BONUS = 40;
const ZERO_SPEED_BONUS_AT_MS = 600_000; // 10:00

/** MAX_SPEED_BONUS at totalMs=0, falling smoothly to 0 by ZERO_SPEED_BONUS_AT_MS. */
function speedBonus(totalMs: number): number {
  const fraction = Math.max(0, 1 - totalMs / ZERO_SPEED_BONUS_AT_MS);
  return MAX_SPEED_BONUS * fraction;
}

export interface DailyScore {
  points: number;
  /** The best score achievable on this exact set of results — varies with the
   *  day's question count and each question's own maxWrong, so it's computed
   *  alongside `points` rather than being a fixed constant. */
  max: number;
}

/**
 * Score a completed daily: accuracy (completion fraction × a flat
 * per-question ceiling, minus a wrong-guess penalty scaled to that
 * question's own guess budget, plus a perfect-round bonus scaled the same
 * way) plus a speed bonus for finishing the whole day quickly. Pure function
 * of the stored results, so it's safe to recompute at share time rather than
 * needing to be stored itself.
 *
 * No backend — this is meant to be compared by pasting it in a chat with
 * friends who played the same day, the same way the emoji grid already is.
 */
export function computeDailyScore(results: RoundResult[]): DailyScore {
  if (results.length === 0) return { points: 0, max: 0 };
  let points = 0;
  let max = 0;
  for (const r of results) {
    const accuracy = r.total > 0 ? (r.found / r.total) * POINTS_PER_QUESTION : 0;
    // Using the question's WHOLE wrong-guess budget cancels its accuracy
    // points entirely, wherever that budget happens to sit (2 for career, 3
    // for list/match, 6 for squad) — so a miss costs roughly the same
    // *relative* to the format's own difficulty, not a flat amount that's
    // brutal against a 2-guess budget and invisible against a 6-guess one.
    const penaltyPerWrong = r.maxWrong > 0 ? POINTS_PER_QUESTION / r.maxWrong : 0;
    const penalty = Math.min(accuracy, r.wrong * penaltyPerWrong);
    points += accuracy - penalty;
    const perfectBonus = r.maxWrong * PERFECT_BONUS_PER_WRONG_BUDGET;
    if (r.won && r.wrong === 0) points += perfectBonus;
    max += POINTS_PER_QUESTION + perfectBonus;
  }
  // Only award a speed bonus if every question actually recorded a time — an
  // old stored result without elapsedMs would otherwise look impossibly fast.
  const timed = results.length > 0 && results.every((r) => r.elapsedMs != null);
  if (timed) {
    const totalMs = results.reduce((sum, r) => sum + (r.elapsedMs ?? 0), 0);
    points += speedBonus(totalMs);
  }
  max += MAX_SPEED_BONUS;
  // Fractional accuracy (e.g. 2 of 3 match slots → 26.67 of 40) is real math
  // but an ugly display; round only the final total, not the running sum, so
  // rounding error can't compound across questions.
  return { points: Math.round(points), max };
}

export function buildShareText(result: DailyResult, url = 'nishadranade.github.io/ball-knowledge'): string {
  const rows = result.results.map(formatRoundRow);
  const { points, max } = computeDailyScore(result.results);
  return [`⚽ Ball Knowledge #${result.day} — ${points}/${max} pts`, '', ...rows, '', url].join('\n');
}

/** The `?q=` token for a question. Only hashed when the id would otherwise spell
 *  an answer. LIST ids just restate the (visible) prompt, and MATCH ids name the
 *  fixture and date — both already on screen, and neither names a scorer. CAREER
 *  ids ARE the player's name, so those use an OPAQUE hash token instead. */
export function questionParam(q: Question): string {
  return q.format === 'CAREER_PATH' ? `c${hashString(q.id).toString(36)}` : q.id;
}

/** Resolve a `?q=` param back to a question. List and match ids match directly;
 *  career tokens match by hashing each career question's id. Returns null if
 *  unknown (stale link) → caller falls back to the practice deck. */
export function resolveQuestionParam(param: string, questions: Question[]): Question | null {
  // Direct id match (list/match links, and a safety net for any literal id).
  const byId = questions.find((q) => q.id === param);
  if (byId) return byId;
  // Career hash token, e.g. "c1a2b3".
  return questions.find((q) => q.format === 'CAREER_PATH' && questionParam(q) === param) ?? null;
}

/** Absolute deep link to a specific question, e.g.
 *  "https://nishadranade.github.io/ball-knowledge/?q=<token>". Uses the current
 *  origin + Vite BASE_URL so it works on any host / base path. A query param
 *  (not a path) is required — GitHub Pages has no SPA path routing. Career links
 *  are opaque (see `questionParam`) so they don't reveal the answer. */
export function buildQuestionLink(q: Question, origin?: string, base?: string): string {
  const o = origin ?? (typeof location !== 'undefined' ? location.origin : '');
  const b = base ?? (typeof import.meta !== 'undefined' ? import.meta.env.BASE_URL : '/');
  return `${o}${b}?q=${encodeURIComponent(questionParam(q))}`;
}

/** Spoiler-free share text for a single Practice question: the prompt (which
 *  names the challenge but never the answers), the result row, and a deep link
 *  the recipient can open to play that exact question fresh. */
export function buildPracticeShareText(result: RoundResult, prompt: string, link: string): string {
  return [`⚽ Ball Knowledge`, prompt, formatRoundRow(result), '', link].join('\n');
}
