/**
 * All-time Champions League top scorers from Wikipedia's
 * "List of UEFA Champions League top scorers" — a clean, genuinely all-time
 * ranked table (includes the pre-2004/05 era the pulselive API is missing, so
 * players like Crespo/Raúl/Shevchenko get their true totals).
 *
 * Used ONLY for CL goals. Other CL metrics still come from the pulselive API.
 */

import { fetchWikitext, parseNameCell, deriveLastName } from './wikipedia.js';
import type { PlayerRow } from './plAggregate.js';

const PAGE = 'List_of_UEFA_Champions_League_top_scorers';

/** flagicon code → our canonical country display name (must match COUNTRIES in
 *  question-templates.ts). Historical variants map to the modern nation. */
const FLAG_TO_COUNTRY: Record<string, string> = {
  ARG: 'Argentina',
  BEL: 'Belgium',
  BIH: 'Bosnia & Herzegovina',
  BRA: 'Brazil',
  CIV: 'Ivory Coast',
  CMR: 'Cameroon',
  CRO: 'Croatia',
  DEN: 'Denmark',
  EGY: 'Egypt',
  ENG: 'England',
  ESP: 'Spain',
  FRA: 'France',
  FRG: 'Germany', // West Germany → Germany
  GER: 'Germany',
  GHA: 'Ghana',
  HUN: 'Hungary',
  ITA: 'Italy',
  NED: 'Netherlands',
  NOR: 'Norway',
  POL: 'Poland',
  POR: 'Portugal',
  SEN: 'Senegal',
  SRB: 'Serbia',
  SWE: 'Sweden',
  UKR: 'Ukraine',
  URU: 'Uruguay',
  WAL: 'Wales',
};

/** First flagicon code in a cell, normalized (drops "|variant=..." suffixes). */
function parseFlagCode(cell: string): string | null {
  const m = cell.match(/\{\{flagicon\|([A-Za-z]{2,3})/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Fetch + parse the all-time CL scorers table into PlayerRow[] (goals metric).
 * Only overall + per-country scopes are meaningful (no reliable per-club data
 * here), so `clubs` is left empty.
 */
export async function fetchChampionsLeagueScorers(): Promise<PlayerRow[]> {
  const wt = await fetchWikitext(PAGE);
  const start = wt.indexOf('{|');
  const end = wt.indexOf('\n|}', start);
  const table = wt.slice(start, end === -1 ? undefined : end);

  // Don't rely on "\n|-" row separators: this table uses |-<noinclude> markers
  // and rowspan-shared ranks for tied players, which break naive row splitting.
  // Instead, iterate line-by-line: each player is a `! scope="row" … flagicon …`
  // line, and their Goals is the first `| <integer>` cell that follows it.
  const lines = table.split('\n');
  const rows: PlayerRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/scope="row"/.test(line) || !/flagicon/i.test(line)) continue;
    const fullName = parseNameCell(line);
    const flag = parseFlagCode(line);
    if (!fullName) continue;

    // Scan forward for the first standalone integer cell (Goals).
    let goals = 0;
    for (let j = i + 1; j < lines.length; j++) {
      const c = lines[j].trim();
      if (/scope="row"/.test(c)) break; // reached the next player without a value
      const m = c.match(/^\|\s*'*(\d+)'*\s*$/); // "| 140" or bold "| '''140'''"
      if (m) {
        goals = Number(m[1]);
        break;
      }
    }
    if (!goals) continue;

    rows.push({
      rank: null, // ranks use rowspan ties; recomputed by the generator's sort
      fullName,
      lastName: deriveLastName(fullName),
      nationality: flag ? (FLAG_TO_COUNTRY[flag] ?? null) : null,
      demonym: null,
      position: null,
      value: goals,
      clubs: [],
    });
  }
  return rows;
}
