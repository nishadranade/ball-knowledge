/**
 * pulselive stats API client (footballapi.pulselive.com) — the Premier League
 * website's own backend, which also serves all-time Champions League data.
 *
 * It is free and needs no key, but it is UNDOCUMENTED and requires an Origin
 * header. To insulate the game from it:
 *  - it is only ever called at BUILD time (never from the browser);
 *  - every response is cached on disk (scripts/.cache/pl/);
 *  - the aggregator validates output before writing questions.json.
 *
 * Ranked-stat endpoint:
 *   /football/stats/ranked/players/{metric}?page=&pageSize=&comps={id}[&teams=ID]
 *   comps=1 => Premier League, comps=2 => UEFA Champions League (all-time).
 *   Omitting compSeasons => all-time. NOTE: per-team (teams=ID) filtering only
 *   works for English clubs, so club scoping is PL-only.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const BASE = 'https://footballapi.pulselive.com/football';
const CACHE_DIR = 'scripts/.cache/pl';

/** pulselive competition ids we use. */
export const COMPS = { PREMIER_LEAGUE: 1, CHAMPIONS_LEAGUE: 2 } as const;
export type CompsId = (typeof COMPS)[keyof typeof COMPS];
/** Short slug per comps id for cache-key namespacing. */
const COMP_SLUG: Record<number, string> = { 1: 'pl', 2: 'cl' };
const HEADERS = {
  Origin: 'https://www.premierleague.com',
  Referer: 'https://www.premierleague.com/',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
};
const MIN_GAP_MS = 200;

/** Metric endpoint slugs on the PL API. */
export type PlMetric = 'goals' | 'goal_assist' | 'clean_sheet' | 'appearances';

export interface PlRankedEntry {
  rank: number;
  value: number;
  playerId: number;
  name: string;
  nationality: string | null;
  demonym: string | null;
  /** 'G' | 'D' | 'M' | 'F' | null, from owner.info.position. */
  position: string | null;
}

let lastAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cachedFetch(url: string, cacheKey: string): Promise<any> {
  const file = path.join(CACHE_DIR, `${cacheKey}.json`);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    /* miss */
  }
  const since = Date.now() - lastAt;
  if (since < MIN_GAP_MS) await sleep(MIN_GAP_MS - since);
  lastAt = Date.now();

  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`PL API ${res.status} for ${url}`);
  const json = await res.json();
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(json));
  return json;
}

function parseEntry(raw: any): PlRankedEntry | null {
  const owner = raw.owner ?? {};
  const name = owner?.name?.display;
  if (!name) return null;
  const nt = owner.nationalTeam ?? {};
  return {
    rank: Number(raw.rank),
    value: Number(raw.value),
    playerId: Number(owner.playerId ?? owner.id ?? 0),
    name,
    nationality: nt.country ?? null,
    demonym: nt.demonym ?? null,
    position: owner.info?.position ?? null,
  };
}

/**
 * Fetch a full ranked leaderboard for a metric, all-time, paging until we have
 * everyone at/above `minValue` (default: down to a floor to bound requests).
 * Optionally scoped to a single team.
 */
export async function fetchRanked(
  metric: PlMetric,
  opts: { comps?: CompsId; teamId?: number; maxPages?: number; pageSize?: number } = {},
): Promise<PlRankedEntry[]> {
  const comps = opts.comps ?? COMPS.PREMIER_LEAGUE;
  const pageSize = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 5; // 500 players deep is plenty for top-N questions
  const compSlug = COMP_SLUG[comps] ?? `c${comps}`;
  const out: PlRankedEntry[] = [];
  for (let page = 0; page < maxPages; page++) {
    const teamPart = opts.teamId != null ? `&teams=${opts.teamId}` : '';
    const url = `${BASE}/stats/ranked/players/${metric}?page=${page}&pageSize=${pageSize}&comps=${comps}${teamPart}`;
    // Cache key namespaced by competition so PL and CL never collide.
    const cacheKey = `${compSlug}_${metric}${opts.teamId != null ? `_team${opts.teamId}` : '_all'}_p${page}`;
    let json: any;
    try {
      json = await cachedFetch(url, cacheKey);
    } catch (e) {
      // A team with no data for this metric may 4xx/return empty — stop paging.
      break;
    }
    const content = json?.stats?.content ?? [];
    if (!content.length) break;
    for (const raw of content) {
      const e = parseEntry(raw);
      if (e) out.push(e);
    }
    const info = json?.pageInfo;
    if (info && info.page >= info.numPages - 1) break;
  }
  return out;
}

/** All PL clubs (id + name), all-time. */
export async function fetchTeams(): Promise<{ id: number; name: string }[]> {
  const url = `${BASE}/teams?pageSize=100&comps=1&altIds=true&page=0`;
  const json = await cachedFetch(url, 'teams_all');
  return (json.content ?? [])
    .map((t: any) => ({ id: Number(t.id), name: String(t.name) }))
    .filter((t: { id: number; name: string }) => Number.isFinite(t.id) && t.name);
}
