/**
 * All-time Champions League player lists from Wikipedia — clean, genuinely
 * all-time ranked tables (include the pre-2004/05 era the pulselive API misses,
 * so Crespo/Raúl/Maldini/Casillas get their true totals).
 *
 *  - fetchChampionsLeagueScorers()     → goals   ("List of UEFA Champions League top scorers")
 *  - fetchChampionsLeagueAppearances() → apps    ("List of footballers with 100+ UEFA CL appearances")
 *
 * Both return the shared PlayerRow shape. Overall + per-country scopes only
 * (no reliable per-club data here), so `clubs` is left empty.
 */

import { fetchWikitext, parseNameCell, deriveLastName } from './wikipedia.js';
import type { PlayerRow } from './plAggregate.js';

const SCORERS_PAGE = 'List_of_UEFA_Champions_League_top_scorers';
const APPEARANCES_PAGE = 'List_of_footballers_with_100_or_more_UEFA_Champions_League_appearances';

/** flagicon 2–3 letter code → our canonical country display name (must match
 *  COUNTRIES in question-templates.ts). Historical variants map to modern nation. */
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

/** Country display names we recognise (for the {{flag|Name}} / {{fba|Name}} path). */
const KNOWN_COUNTRY_NAMES = new Set(Object.values(FLAG_TO_COUNTRY));
// A few full-name spellings Wikipedia uses that differ from our display names.
const COUNTRY_NAME_ALIASES: Record<string, string> = {
  'Republic of Ireland': 'Republic of Ireland',
  'Ivory Coast': 'Ivory Coast',
  "Côte d'Ivoire": 'Ivory Coast',
};

/**
 * Extract a country display name from a cell using any of the flag templates
 * Wikipedia uses across these tables:
 *   {{flagicon|POR}}  (code)      — scorers list
 *   {{flag|Portugal}} (full name) — appearances list
 *   {{fba|Wales}}     (full name) — records/assists tables
 */
function parseNation(cell: string): string | null {
  const code = cell.match(/\{\{flagicon\|([A-Za-z]{2,3})/i);
  if (code) return FLAG_TO_COUNTRY[code[1].toUpperCase()] ?? null;
  const named = cell.match(/\{\{(?:flag|fb[a-z]*|flagg?)\|\s*([^}|]+?)\s*(?:\||\}\})/i);
  if (named) {
    const name = named[1].trim();
    if (COUNTRY_NAME_ALIASES[name]) return COUNTRY_NAME_ALIASES[name];
    if (KNOWN_COUNTRY_NAMES.has(name)) return name;
    return name; // pass through; canonicalCountry in the generator filters unknowns
  }
  return null;
}

/**
 * Parse a Wikipedia ranked player table into PlayerRow[]. Tables in this family
 * use `|-<noinclude>` markers and rowspan-shared ranks (ties), which break naive
 * "\n|-" splitting — so iterate line by line. Each player is a row whose
 * `scope="row"` line carries the name; the metric value is the first standalone
 * integer cell after it; nationality is found on the name line OR the lines up to
 * the value (layout differs per page).
 */
function parseRankedTable(wikitext: string): PlayerRow[] {
  const start = wikitext.indexOf('{|');
  const end = wikitext.indexOf('\n|}', start);
  const table = wikitext.slice(start, end === -1 ? undefined : end);
  const lines = table.split('\n');
  const rows: PlayerRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/scope="row"/.test(line) || !/\[\[/.test(line)) continue;
    const fullName = parseNameCell(line);
    if (!fullName) continue;

    // Nationality may be on the name line (scorers) or a following cell (apps).
    let nationality = parseNation(line);
    let value = 0;
    for (let j = i + 1; j < lines.length; j++) {
      const c = lines[j].trim();
      if (/scope="row"/.test(c)) break; // next player
      if (!nationality) nationality = parseNation(c);
      const m = c.match(/^\|\s*'*(\d+)'*\s*$/); // "| 183" or bold "| '''183'''"
      if (m) {
        value = Number(m[1]);
        break;
      }
    }
    if (!value) continue;

    rows.push({
      rank: null, // ranks use rowspan ties; the generator re-sorts by value
      fullName,
      lastName: deriveLastName(fullName),
      nationality,
      demonym: null,
      position: null,
      value,
      clubs: [],
    });
  }
  return rows;
}

/** All-time CL goals (goals metric). */
export async function fetchChampionsLeagueScorers(): Promise<PlayerRow[]> {
  return parseRankedTable(await fetchWikitext(SCORERS_PAGE));
}

/**
 * All-time CL appearances. This table's column order is
 * Rank | Player | Nation | Apps | Years | Club(s), and both Rank and Apps can be
 * `rowspan`-shared across tied players — so a naive "first integer after the
 * name" grab fails (it hits the next player's rank, or a year). Parse by row
 * block instead: the Apps value is the bare-integer cell that comes AFTER the
 * nation cell; rowspan-shared Apps carry forward to the tied rows below.
 */
export async function fetchChampionsLeagueAppearances(): Promise<PlayerRow[]> {
  const wt = await fetchWikitext(APPEARANCES_PAGE);
  const start = wt.indexOf('{|');
  const end = wt.indexOf('\n|}', start);
  const table = wt.slice(start, end === -1 ? undefined : end);

  const rows: PlayerRow[] = [];
  let carriedApps = 0; // last rowspan Apps value, for tied rows that omit it
  for (const block of table.split(/\n\|-/)) {
    if (!/scope="row"/.test(block) || !/\[\[/.test(block)) continue;

    // Split into cells: lines starting with | or the ! name line.
    const nameLine = block.split('\n').find((l) => /scope="row"/.test(l));
    const fullName = nameLine ? parseNameCell(nameLine) : null;
    if (!fullName) continue;
    const nationality = parseNation(block);

    // Apps = first bare-integer `|` cell that is NOT the leading rank. A cell with
    // rowspan carries its value forward. Cells look like "| 177" or "| rowspan=\"4\" | 109".
    const cellInts: { value: number; rowspan: boolean }[] = [];
    for (const raw of block.split('\n')) {
      const l = raw.trim();
      if (!l.startsWith('|') || /scope="row"/.test(l)) continue;
      const rs = l.match(/^\|\s*rowspan="\d+"\s*\|\s*(\d+)\s*$/);
      const plain = l.match(/^\|\s*(\d+)\s*$/);
      if (rs) cellInts.push({ value: Number(rs[1]), rowspan: true });
      else if (plain) cellInts.push({ value: Number(plain[1]), rowspan: false });
    }
    // Column layout: [rank?, apps, ...]. In a standalone row we see rank then apps
    // (two ints); in a rowspan-tied row the shared rank/apps are omitted, so we see
    // 0 leading ints and must use the carried value.
    let apps = 0;
    if (cellInts.length >= 2) {
      apps = cellInts[1].value; // rank, apps
      if (cellInts[1].rowspan) carriedApps = apps;
    } else if (cellInts.length === 1) {
      // Either a shared rank with own apps, or own rank with shared apps.
      if (cellInts[0].rowspan) {
        apps = cellInts[0].value;
        carriedApps = apps;
      } else {
        apps = carriedApps || cellInts[0].value;
      }
    } else {
      apps = carriedApps; // fully tied row (shares both rank and apps)
    }
    if (!apps) continue;

    rows.push({
      rank: null,
      fullName,
      lastName: deriveLastName(fullName),
      nationality,
      demonym: null,
      position: null,
      value: apps,
      clubs: [],
    });
  }
  return rows;
}
