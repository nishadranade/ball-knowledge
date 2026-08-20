/**
 * "Is this fixture worth asking about" — shared by build-matches.ts (scorer
 * questions) and build-squads.ts (starting-XI questions) so the two pools of
 * fixtures never drift apart from each other for no reason. Originally lived
 * only in build-matches.ts; extracted here when build-squads.ts needed the
 * identical filter.
 */

import { COMPS, type FixtureSummary } from './plFixtures.js';
import type { CompsId } from './premierLeague.js';
import type { Difficulty } from '../../src/game/types.js';

/** Goal threshold for a big-vs-non-big fixture that wasn't an upset. */
const MIN_GOALS_MIXED = 3;
/** Fixtures within this many years are STANDARD; older ones are HARD. Recency
 *  is a rough but decent proxy for how memorable a scoreline/line-up is. */
const STANDARD_WITHIN_YEARS = 5;

/** PL clubs whose matches are well-known enough to ask about. Exact pulselive
 *  team names — a typo here silently drops every match for that club. */
export const BIG_SIX = new Set([
  'Arsenal',
  'Chelsea',
  'Liverpool',
  'Manchester City',
  'Manchester United',
  'Tottenham Hotspur',
]);

/**
 * Continental heavyweights, for filtering Champions League SQUAD questions to
 * fixtures a fan would recognize even without one of England's own big six in
 * it. Exact pulselive team-name strings (checked against the generated CL
 * bank), same fragility caveat as BIG_SIX above.
 *
 * Only used by build-squads.ts today — MATCH's CL rule stays "any knockout
 * tie qualifies" (the round is its own quality filter there); changing that
 * too wasn't asked for, so it's left alone.
 */
export const BIG_EUROPE = new Set([
  'Real Madrid',
  'FC Barcelona',
  'Atlético Madrid',
  'FC Bayern München',
  'Borussia Dortmund',
  'Paris Saint Germain',
  'Juventus',
  'Internazionale',
  'Milan',
]);

/** Whether `team` counts as "big" for `comps`. BIG_SIX counts in either
 *  competition (an English big-six side is still big when it's in the CL);
 *  BIG_EUROPE only applies outside the PL, since it's not an English-club
 *  list and PL's own big/non-big rule is BIG_SIX-only by design. */
export function isBigTeam(team: string, comps: CompsId): boolean {
  if (BIG_SIX.has(team)) return true;
  return comps !== COMPS.PREMIER_LEAGUE && BIG_EUROPE.has(team);
}

/** Whether a Champions League fixture has at least one marquee side in it —
 *  an English big six club, or a continental heavyweight. */
export function isBigClFixture(f: FixtureSummary): boolean {
  return isBigTeam(f.homeTeam, COMPS.CHAMPIONS_LEAGUE) || isBigTeam(f.awayTeam, COMPS.CHAMPIONS_LEAGUE);
}

/**
 * Which matches qualify:
 *  - Premier League, BIG vs BIG        — always; these are the marquee fixtures
 *  - Premier League, BIG vs non-big    — only if it was a 3+ goal game, OR the
 *                                        non-big side won (an upset is memorable
 *                                        however few goals it took)
 *  - Premier League, neither side big  — never
 *  - Champions League                  — knockout ties (the round is its own
 *                                        quality filter, and it avoids brittle
 *                                        matching on European club names)
 */
export function qualifies(f: FixtureSummary, comps: CompsId): boolean {
  if (comps !== COMPS.PREMIER_LEAGUE) return Boolean(f.knockoutRound);

  const homeBig = BIG_SIX.has(f.homeTeam);
  const awayBig = BIG_SIX.has(f.awayTeam);
  if (homeBig && awayBig) return true; // marquee fixture — no threshold
  if (!homeBig && !awayBig) return false;

  // Exactly one big side. An upset is worth asking about however dull the
  // scoreline; otherwise the game has to have had some goals in it.
  const nonBigWon = homeBig ? f.awayScore > f.homeScore : f.homeScore > f.awayScore;
  return nonBigWon || f.homeScore + f.awayScore >= MIN_GOALS_MIXED;
}

/** "Round of 16" + FIRST_LEG → "Round of 16, first leg". */
export function roundLabel(f: FixtureSummary): string | undefined {
  if (!f.knockoutRound) return undefined;
  const leg =
    f.fixtureType === 'FIRST_LEG'
      ? ', first leg'
      : f.fixtureType === 'SECOND_LEG'
        ? ', second leg'
        : '';
  return `${f.knockoutRound}${leg}`;
}

export function difficultyFor(date: string): Difficulty {
  const years = (Date.now() - new Date(`${date}T00:00:00Z`).getTime()) / (365.25 * 24 * 3600 * 1000);
  return years <= STANDARD_WITHIN_YEARS ? 'STANDARD' : 'HARD';
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
