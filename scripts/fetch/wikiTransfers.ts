/**
 * A club's highest transfer fees paid, from its "List of X F.C. records and
 * statistics" Wikipedia page — specifically the "Highest transfer fees paid"
 * subsection, a consistently-templated table across the clubs that have it
 * (confirmed on Chelsea before building this: Rank | Player | From | Fee (£m)
 * | Year, cells on one line separated by "||" — a different MediaWiki table
 * style than the managers page family, which put one cell per line).
 *
 * NOT every club has this page, or this section on it — a survey before
 * building this found roughly half of the clubs checked do (the bigger/
 * richer ones, unsurprisingly). Callers treat null as "skip this club".
 */

import { fetchWikitext, parseNameCell } from './wikipedia.js';

export interface TransferRecord {
  playerName: string;
  playerLastName: string;
  fromClub: string;
  /** Fee in £ million, e.g. 117 for "£117m". */
  feeMillions: number;
  year: number;
}

export function transfersPageTitle(clubFullName: string): string {
  const base = /F\.?C\.?$/i.test(clubFullName) ? clubFullName : `${clubFullName} F.C.`;
  return `List_of_${base.replace(/\s+/g, '_')}_records_and_statistics`;
}

/** The "Highest transfer fees paid" subsection's own text, up to the next
 *  heading of the same level or higher. Anchoring to this specific heading
 *  (rather than scanning every table on the page, as wikiManagers.ts has
 *  to) is safe here because it's been consistent across every club checked —
 *  this table family doesn't have the wide format drift the managers one did. */
function extractSection(wikitext: string): string | null {
  const heading = wikitext.match(/={2,6}\s*Highest transfer fees paid\s*={2,6}/i);
  if (!heading) return null;
  const level = heading[0].match(/^=+/)![0].length;
  const start = heading.index! + heading[0].length;
  const rest = wikitext.slice(start);
  const nextHeadingRe = new RegExp(`^={2,${level}}[^=]`, 'm');
  const nextAt = rest.search(nextHeadingRe);
  return nextAt === -1 ? rest : rest.slice(0, nextAt);
}

/** Strip a cell-attribute prefix ("align=\"left\"|..."). Nothing else —
 *  deliberately does NOT truncate at the first "{{": a player/club cell
 *  looks like `{{flagicon|ENG}} [[Morgan Rogers]]`, where the template comes
 *  BEFORE the real content (a flag icon), not after it as trailing citation
 *  junk. Confirmed truncating unconditionally there ate the whole cell.
 *  parseNameCell finds the [[wikilink]] regardless of what surrounds it. */
function stripAttrPrefix(raw: string): string {
  return raw.trim().replace(/^[a-zA-Z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^|]+)\s*\|/, '').trim();
}

/** For a NUMERIC cell (fee, year): the real value is always plain text at
 *  the START, with citation/footnote junk (if any) trailing it — so THIS
 *  cleaner truncates at the first "{{" (a {{efn|...}}/{{cite...}} template)
 *  and strips a trailing <ref>. The inverse ordering from player/club cells,
 *  which is exactly why these are two separate functions, not one. */
function cleanNumericCell(raw: string): string {
  return stripAttrPrefix(raw)
    .split('{{')[0]
    .replace(/<ref[^>]*\/?>(?:[\s\S]*?<\/ref>)?/gi, '')
    .trim();
}

/**
 * Parse a fee cell into £ million. THREE formats confirmed across clubs:
 * "£117" / "£106.8" (already in millions, Chelsea-style), "£89.3&nbsp;
 * million" (explicit word, still already in millions, Man Utd-style), and
 * "£34,600,000" (the full comma-grouped figure — Fulham). The comma form
 * must be checked FIRST and divided by 1e6: matching it with the plain
 * "digits after £" regex alone would silently truncate at the first comma
 * (34,600,000 -> 34), a real precision bug this fixed before it shipped.
 */
function parseFee(cell: string): number | null {
  const cleaned = cleanNumericCell(cell);
  const commaFigure = cleaned.match(/£\s*([\d,]+)/);
  if (commaFigure && commaFigure[1].includes(',')) {
    return Number(commaFigure[1].replace(/,/g, '')) / 1_000_000;
  }
  const plain = cleaned.match(/£\s*([\d.]+)/);
  return plain ? Number(plain[1]) : null;
}

function parseYear(cell: string): number | null {
  const m = cleanNumericCell(cell).match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

/** One transfer-record row: "|<rank>\n|<player>||<from>||<fee>||<year>". */
function parseRow(block: string): TransferRecord | null {
  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // The remaining (non-rank) cells are on ONE line, "||"-separated — find
  // that line by splitting on "||" and keeping whichever split yields at
  // least 4 parts. Two different row layouts confirmed across clubs: some
  // (Chelsea) put the rank on its OWN preceding line ("|1", then the rest);
  // others (Manchester United) put it as the first "||"-cell of this SAME
  // line ("|1||player||from||fee||date"). Handle both: after splitting, drop
  // a leading cell if it's a bare small integer — a real player/from/fee/
  // date cell never is.
  const cellsLine = lines.find((l) => l.startsWith('|') && l.split('||').length >= 4);
  if (!cellsLine) return null;
  let cells = cellsLine
    .replace(/^\|+/, '')
    .split('||')
    .map((c) => c.trim());
  if (/^\d+$/.test(cells[0])) cells = cells.slice(1);
  if (cells.length < 4) return null;
  const [playerCell, fromCell, feeCell, yearCell] = cells;

  const playerName = parseNameCell(stripAttrPrefix(playerCell));
  const fromClub = parseNameCell(stripAttrPrefix(fromCell));
  const fee = parseFee(feeCell);
  const year = parseYear(yearCell);
  if (!playerName || !fromClub || fee == null || year == null) return null;

  return { playerName, playerLastName: deriveLastNameLocal(playerName), fromClub, feeMillions: fee, year };
}

// Small local copy rather than importing deriveLastName, to avoid a
// dependency on wikipedia.ts's particle list for a case this table doesn't
// actually need handled with that much nuance — a plain last-token split is
// fine here, and player names in THIS table are always western order.
function deriveLastNameLocal(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? fullName;
}

/** Parse the "Highest transfer fees paid" table out of a page's full
 *  wikitext. Pure — exported for unit testing against fixture wikitext
 *  without a network fetch. */
export function parseTransferTable(wikitext: string): TransferRecord[] {
  const section = extractSection(wikitext);
  if (!section) return [];
  const tableStart = section.indexOf('{|');
  if (tableStart === -1) return [];
  const tableEnd = section.indexOf('\n|}', tableStart);
  const table = section.slice(tableStart, tableEnd === -1 ? undefined : tableEnd);

  const records: TransferRecord[] = [];
  for (const block of table.split(/\n\|-/)) {
    const row = parseRow(block);
    if (row) records.push(row);
  }
  return records;
}

export interface ClubTransfers {
  records: TransferRecord[];
  pageTitle: string;
}

/** Fetch + parse one club's highest-fees-paid table. Null if the club has no
 *  usable page/section — see the module comment. */
export async function fetchTransferRecords(clubFullName: string): Promise<ClubTransfers | null> {
  const title = transfersPageTitle(clubFullName);
  let wikitext: string;
  try {
    wikitext = await fetchWikitext(title);
  } catch {
    return null;
  }
  const records = parseTransferTable(wikitext);
  return records.length ? { records, pageTitle: title } : null;
}
