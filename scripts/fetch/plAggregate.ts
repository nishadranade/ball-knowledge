/**
 * Aggregate the Premier League API into the PlayerRow[] shape the question
 * generator consumes (see build-questions.ts). One aggregate per metric.
 *
 * For each metric we gather:
 *  - the all-time overall leaderboard (carries nationality) → overall & per-country
 *  - per-team leaderboards for every PL club → correct per-club rankings
 *    (the club value is the player's total FOR THAT CLUB, which the old
 *     Wikipedia data got wrong).
 */

import { fetchRanked, COMPS, type PlMetric, type CompsId } from './premierLeague.js';
import { deriveLastName } from './wikipedia.js';
import type { Metric } from '../question-templates.js';

/** Map our internal Metric names to PL API endpoint slugs. */
export const METRIC_SLUG: Record<Metric, PlMetric | null> = {
  goals: 'goals',
  assists: 'goal_assist',
  appearances: 'appearances',
  cleanSheets: 'clean_sheet',
};

export interface ClubSplit {
  club: string;
  count: number;
}

export interface PlayerRow {
  rank: number | null;
  fullName: string;
  lastName: string;
  nationality: string | null; // country name, e.g. "England"
  demonym: string | null; // e.g. "English"
  position: string | null;
  value: number; // overall metric value
  clubs: ClubSplit[]; // per-club totals for this metric
}

export interface MetricAggregate {
  metric: Metric;
  rows: PlayerRow[]; // overall ranking with nationality + per-club splits attached
}

/**
 * Build the aggregate for one metric.
 * @param teams full club list (used only for PL per-club splits; pass [] to skip)
 * @param depthPages how many 100-player pages to pull for the overall board
 * @param comps pulselive competition id (PL=1, CL=2). CL has no usable per-club
 *   data (team ids are English-only), so pass teams=[] for CL.
 */
export async function aggregateMetric(
  metric: Metric,
  teams: { id: number; name: string }[],
  depthPages = 5,
  comps: CompsId = COMPS.PREMIER_LEAGUE,
): Promise<MetricAggregate> {
  const slug = METRIC_SLUG[metric];
  if (!slug) return { metric, rows: [] };

  // 1) Overall all-time leaderboard (nationality lives here).
  const overall = await fetchRanked(slug, { comps, maxPages: depthPages });
  const byId = new Map<number, PlayerRow>();
  const byName = new Map<string, PlayerRow>();
  // Track which players had an authoritative all-time value from the overall
  // board. Players discovered ONLY via per-club boards must have their total
  // derived by summing club splits (a single club's value is not the total).
  const fromOverall = new Set<PlayerRow>();
  for (const e of overall) {
    const row: PlayerRow = {
      rank: e.rank,
      fullName: e.name,
      lastName: deriveLastName(e.name),
      nationality: e.nationality,
      demonym: e.demonym,
      position: e.position,
      value: e.value,
      clubs: [],
    };
    fromOverall.add(row);
    if (e.playerId) byId.set(e.playerId, row);
    byName.set(e.name, row);
  }

  // 2) Per-club leaderboards → attach club splits. A player's club value is the
  //    total for that club; we also surface players who don't appear in the
  //    overall top pages (relevant for the long tail) by adding them as rows.
  for (const team of teams) {
    const clubBoard = await fetchRanked(slug, { comps, teamId: team.id, maxPages: 2 });
    for (const e of clubBoard) {
      let row = (e.playerId && byId.get(e.playerId)) || byName.get(e.name);
      if (!row) {
        row = {
          rank: null,
          fullName: e.name,
          lastName: deriveLastName(e.name),
          nationality: e.nationality,
          demonym: e.demonym,
          position: e.position,
          value: 0, // derived below from the sum of club splits
          clubs: [],
        };
        if (e.playerId) byId.set(e.playerId, row);
        byName.set(e.name, row);
      }
      // Record the club split (dedupe by club name).
      if (!row.clubs.some((c) => c.club === team.name)) {
        row.clubs.push({ club: team.name, count: e.value });
      }
    }
  }

  // 3) For players NOT in the overall board, their all-time value = sum of club
  //    splits (e.g. Isak assists: Newcastle 9 + Liverpool 1 = 10, not 1).
  for (const row of byName.values()) {
    if (!fromOverall.has(row)) {
      row.value = row.clubs.reduce((sum, c) => sum + c.count, 0);
    }
  }

  return { metric, rows: [...byName.values()] };
}
