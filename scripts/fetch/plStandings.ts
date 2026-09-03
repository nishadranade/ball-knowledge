/**
 * Final league table per season, from the same pulselive API.
 *
 *   /football/standings?compSeasons={id}&comps={id}
 *
 * Confirmed working back to 1992/93 (compSeasons id 1, 22 clubs that season).
 * Shared by build-season-stats.ts (to know which seasons are actually
 * complete, not just "exists") and build-club-history.ts (relegation/
 * promotion/top-N-finish questions).
 */

import { cachedGet, PL_BASE, COMPS, type CompsId } from './premierLeague.js';
import type { CompSeason } from './plFixtures.js';

const COMP_SLUG: Record<number, string> = { 1: 'pl', 2: 'cl' };

export interface StandingsEntry {
  position: number;
  /** Full club name, e.g. "Manchester United" — matches the name used
   *  elsewhere (fixtures, per-club LIST scoping). */
  team: string;
  /** Short form, e.g. "Man Utd" — useful as an alias, not the primary name. */
  shortName: string;
  played: number;
  points: number;
}

export interface SeasonStandings {
  season: CompSeason;
  /** Ordered by finishing position, 1st first. */
  entries: StandingsEntry[];
}

/** A full PL season has played every club 38 times (20 clubs) since 1995/96,
 *  or 42 times (22 clubs) before that. Anything short of that is a season
 *  still in progress — its "final" table isn't final yet. */
const FULL_SEASON_MIN_PLAYED = 38;

export async function fetchStandings(
  season: CompSeason,
  comps: CompsId = COMPS.PREMIER_LEAGUE,
): Promise<SeasonStandings | null> {
  const slug = COMP_SLUG[comps] ?? `c${comps}`;
  let json: any;
  try {
    json = await cachedGet(
      `${PL_BASE}/standings?compSeasons=${season.id}&comps=${comps}`,
      `${slug}_standings_${season.id}`,
    );
  } catch {
    return null;
  }
  const table = json?.tables?.[0];
  const rows = table?.entries ?? [];
  if (!rows.length) return null;
  const entries: StandingsEntry[] = rows
    .map((e: any) => ({
      position: Number(e?.position ?? 0),
      team: String(e?.team?.name ?? ''),
      shortName: String(e?.team?.club?.shortName ?? e?.team?.name ?? ''),
      played: Number(e?.overall?.played ?? 0),
      points: Number(e?.overall?.points ?? 0),
    }))
    .filter((e: StandingsEntry) => e.team && e.position > 0);
  if (!entries.length) return null;
  entries.sort((a, b) => a.position - b.position);
  return { season, entries };
}

/** Whether a season's table reflects a completed season (every club has
 *  played its full fixture list), not one still in progress. */
export function isSeasonComplete(standings: SeasonStandings): boolean {
  return standings.entries.every((e) => e.played >= FULL_SEASON_MIN_PLAYED);
}
