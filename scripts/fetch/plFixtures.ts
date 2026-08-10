/**
 * Match (fixture) data for MATCH questions, from the same pulselive API that
 * serves the stat leaderboards (see premierLeague.ts for the caching/throttling
 * contract this reuses).
 *
 * Two endpoints, used in that order so we only pay for matches we keep:
 *
 *   /fixtures?comps=&compSeasons=&statuses=C   list; carries teams, scores and a
 *                                              goals[] of {personId, type} — enough
 *                                              to decide if a match QUALIFIES
 *   /fixtures/{id}                             detail; carries teamLists (player
 *                                              names + which side) and events[],
 *                                              which is what turns personIds into
 *                                              named, attributed scorers
 *
 * Goal event types: G = goal, P = penalty, O = own goal. Own goals are reported
 * but excluded from the scorer list by the caller — the scorer plays for the
 * opposition, so they make a rotten answer.
 */

import { cachedGet, PL_BASE, COMPS, type CompsId } from './premierLeague.js';
import { deriveLastName } from './wikipedia.js';

const COMP_SLUG: Record<number, string> = { 1: 'pl', 2: 'cl' };

export interface CompSeason {
  id: number;
  label: string;
  /** Starting calendar year, parsed from the label ("2019/20" → 2019). */
  startYear: number;
}

/** All seasons for a competition, newest first. */
export async function fetchSeasons(comps: CompsId): Promise<CompSeason[]> {
  const slug = COMP_SLUG[comps] ?? `c${comps}`;
  const json = await cachedGet(
    `${PL_BASE}/competitions/${comps}/compseasons?pageSize=100`,
    `${slug}_compseasons`,
  );
  const out: CompSeason[] = [];
  for (const s of json?.content ?? []) {
    const label = String(s.label ?? '');
    // Labels vary by competition: "2019/20" (PL) and
    // "UEFA Champions League Season 2019/2020" (CL) both contain the start year.
    const m = label.match(/(\d{4})\s*\//);
    if (!m) continue;
    out.push({ id: Number(s.id), label, startYear: Number(m[1]) });
  }
  return out.sort((a, b) => b.startYear - a.startYear);
}

export interface RawGoal {
  personId: number;
  /** G = goal, P = penalty, O = own goal. */
  type: string;
  /** Minute label, e.g. "44'00". */
  clock?: string;
}

export interface FixtureSummary {
  id: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  /** ISO "YYYY-MM-DD" in UTC. */
  date: string;
  dateLabel: string;
  goals: RawGoal[];
  /** Knockout round label, e.g. "Round of 16" — only for knockout phases. */
  knockoutRound?: string;
  /** FIRST_LEG / SECOND_LEG / CUP, used to disambiguate two-legged ties. */
  fixtureType?: string;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseFixture(raw: any): FixtureSummary | null {
  const teams = raw?.teams ?? [];
  if (teams.length !== 2) return null;
  const [h, a] = teams;
  const homeTeam = h?.team?.name;
  const awayTeam = a?.team?.name;
  if (!homeTeam || !awayTeam) return null;
  // A completed fixture always has both scores; anything else is unusable.
  if (typeof h.score !== 'number' || typeof a.score !== 'number') return null;

  const millis = raw?.kickoff?.millis;
  if (!millis) return null;
  const d = new Date(Number(millis));
  const date = d.toISOString().slice(0, 10);
  const dateLabel = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

  const phase = raw?.gameweek?.competitionPhase;
  // type "K" marks a knockout phase; "Final", "Semi-final", "Round of 16", ...
  const knockoutRound = phase?.type === 'K' ? String(phase.label ?? '') || undefined : undefined;

  return {
    id: Number(raw.id),
    homeTeam,
    awayTeam,
    homeScore: h.score,
    awayScore: a.score,
    date,
    dateLabel,
    knockoutRound,
    fixtureType: raw?.fixtureType ? String(raw.fixtureType) : undefined,
    goals: (raw?.goals ?? [])
      .filter((g: any) => g && g.personId != null)
      .map((g: any) => ({
        personId: Number(g.personId),
        type: String(g.type ?? 'G'),
        clock: g?.clock?.label ? String(g.clock.label) : undefined,
      })),
  };
}

/** Every completed fixture in one season. */
export async function fetchSeasonFixtures(
  comps: CompsId,
  season: CompSeason,
): Promise<FixtureSummary[]> {
  const slug = COMP_SLUG[comps] ?? `c${comps}`;
  const out: FixtureSummary[] = [];
  for (let page = 0; page < 12; page++) {
    let json: any;
    try {
      json = await cachedGet(
        `${PL_BASE}/fixtures?comps=${comps}&compSeasons=${season.id}&page=${page}&pageSize=100&statuses=C&sort=desc`,
        `${slug}_fixtures_s${season.id}_p${page}`,
      );
    } catch {
      break;
    }
    const content = json?.content ?? [];
    if (!content.length) break;
    for (const raw of content) {
      const f = parseFixture(raw);
      if (f) out.push(f);
    }
    const info = json?.pageInfo;
    if (info && info.page >= info.numPages - 1) break;
  }
  return out;
}

export interface ResolvedScorer {
  personId: number;
  fullName: string;
  lastName: string;
  team: string;
  goals: number;
  /** Minute of their first goal — used to order the answer slots. */
  firstMinute: number;
}

export interface FixtureDetail {
  scorers: ResolvedScorer[];
  ownGoals: number;
}

/** Parse "44'00" / "90+3'00" to a sortable minute. */
function minuteOf(label: string | undefined): number {
  if (!label) return 999;
  const m = label.match(/(\d+)(?:\+(\d+))?/);
  if (!m) return 999;
  return Number(m[1]) + (m[2] ? Number(m[2]) / 100 : 0);
}

/**
 * Resolve a fixture's goalscorers to names and sides. Needs the detail endpoint:
 * the list response identifies scorers only by personId, and says nothing about
 * which team they play for.
 *
 * Returns DISTINCT scorers (a brace collapses to one entry with goals: 2),
 * ordered by first goal, own goals excluded but counted.
 */
export async function fetchFixtureDetail(
  fixtureId: number,
  comps: CompsId,
): Promise<FixtureDetail | null> {
  const slug = COMP_SLUG[comps] ?? `c${comps}`;
  let json: any;
  try {
    json = await cachedGet(`${PL_BASE}/fixtures/${fixtureId}`, `${slug}_fixture_${fixtureId}`);
  } catch {
    return null;
  }

  // playerId -> {name, teamId} from both starting XIs and benches.
  const players = new Map<number, { fullName: string; lastName: string; teamId: number }>();
  for (const tl of json?.teamLists ?? []) {
    const teamId = Number(tl?.teamId ?? 0);
    for (const group of ['lineup', 'substitutes'] as const) {
      for (const p of tl?.[group] ?? []) {
        const id = Number(p?.id ?? p?.playerId ?? 0);
        const name = p?.name ?? {};
        const fullName = name.display ?? null;
        if (!id || !fullName) continue;
        players.set(id, {
          fullName,
          // The API gives a real surname field; only fall back to the heuristic
          // splitter when it's missing.
          lastName: name.last || deriveLastName(fullName),
          teamId,
        });
      }
    }
  }
  const teamNames = new Map<number, string>();
  for (const t of json?.teams ?? []) {
    const id = Number(t?.team?.id ?? 0);
    if (id) teamNames.set(id, String(t.team.name));
  }

  const byPerson = new Map<number, ResolvedScorer>();
  let ownGoals = 0;
  for (const e of json?.events ?? []) {
    const type = String(e?.type ?? '');
    if (type === 'O') {
      ownGoals++;
      continue;
    }
    if (type !== 'G' && type !== 'P') continue;
    const pid = Number(e?.personId ?? 0);
    const p = players.get(pid);
    // A scorer missing from both team lists can't be named or attributed —
    // dropping them would silently understate the goals, so fail the fixture.
    if (!p) return null;
    const minute = minuteOf(e?.clock?.label);
    const existing = byPerson.get(pid);
    if (existing) {
      existing.goals++;
      existing.firstMinute = Math.min(existing.firstMinute, minute);
    } else {
      byPerson.set(pid, {
        personId: pid,
        fullName: p.fullName,
        lastName: p.lastName,
        team: teamNames.get(p.teamId) ?? '',
        goals: 1,
        firstMinute: minute,
      });
    }
  }

  return {
    scorers: [...byPerson.values()].sort((a, b) => a.firstMinute - b.firstMinute),
    ownGoals,
  };
}

export { COMPS };
