/**
 * Per-season "deep stat" leaderboards (shots, shots on target, tackles,
 * interceptions, saves) — the same ranked-stat endpoint the all-time
 * goals/assists/appearances/clean-sheets metrics already use
 * (fetch/plAggregate.ts), just additionally scoped to one season via
 * compSeasons. Confirmed against the live API before building this:
 * `total_scoring_att`/`ontarget_scoring_att`/`won_tackle`/`interception`/
 * `saves` are all real metric slugs with real per-season data going back
 * well past 10 years.
 */

import { fetchRanked, type PlMetric } from './premierLeague.js';
import { deriveLastName } from './wikipedia.js';
import type { CompSeason } from './plFixtures.js';

export type SeasonStatMetric = 'shots' | 'shotsOnTarget' | 'tackles' | 'interceptions' | 'saves';

export const SEASON_STAT_SLUG: Record<SeasonStatMetric, PlMetric> = {
  shots: 'total_scoring_att',
  shotsOnTarget: 'ontarget_scoring_att',
  tackles: 'won_tackle',
  interceptions: 'interception',
  saves: 'saves',
};

/** Noun phrase for the prompt, e.g. "the most shots on target". */
export const SEASON_STAT_LABELS: Record<SeasonStatMetric, string> = {
  shots: 'shots',
  shotsOnTarget: 'shots on target',
  tackles: 'tackles',
  interceptions: 'interceptions',
  saves: 'saves',
};

/**
 * Minimum value to count as a qualifying answer for a SINGLE SEASON (much
 * lower than the all-time METRIC_FLOOR in question-templates.ts, since one
 * season is a fraction of a career). Calibrated against real 2020/21 data —
 * e.g. the 10th-most shots-on-target that season was still in the 30s, saves
 * leaders were in the 90s+ — so these floors only trim genuine non-entries,
 * not the tail of a real top-10.
 */
export const SEASON_STAT_FLOOR: Record<SeasonStatMetric, number> = {
  shots: 20,
  shotsOnTarget: 10,
  tackles: 15,
  interceptions: 15,
  saves: 20,
};

export interface SeasonStatEntry {
  fullName: string;
  lastName: string;
  value: number;
  /** 'G' | 'D' | 'M' | 'F' | null, straight from the API — see
   *  build-season-stats.ts's position-split variants (tackles/interceptions/
   *  shots), which filter on this. Unused by the overall (all-position)
   *  question, which is why this wasn't threaded through until that was added. */
  position: string | null;
}

/** One metric's ranked leaderboard for one season, overall only (no
 *  per-club/per-country split — see build-season-stats.ts for why). */
export async function fetchSeasonStat(
  metric: SeasonStatMetric,
  season: CompSeason,
): Promise<SeasonStatEntry[]> {
  const entries = await fetchRanked(SEASON_STAT_SLUG[metric], { compSeasons: season.id, maxPages: 5 });
  return entries.map((e) => ({
    fullName: e.name,
    lastName: deriveLastName(e.name),
    value: e.value,
    position: e.position,
  }));
}
