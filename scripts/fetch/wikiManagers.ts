/**
 * Club managerial history from Wikipedia's "List of X managers" pages — a
 * common but NOT perfectly consistent page family across clubs. Confirmed
 * two real variants before settling on this parser:
 *  - Arsenal: {{dts|30 March 1897}} (single date string), {{WDL|...}} macro
 *    for the match record, "Present" (plain text) for the incumbent.
 *  - Manchester United: {{dts|format=dmy|1900|5|26}} (positional Y/M/D, some
 *    empty for unknown), an extra Image column before the name, table under
 *    "==Statistics==" rather than "==Managers==".
 * Rather than anchor to a specific heading or column position (both vary),
 * this scans every wikitable on the page and keeps whichever one actually
 * parses into the most manager rows — the managers table is, structurally,
 * the whole point of these pages, so it's reliably the best-populated one.
 *
 * Not every club has a page like this at all, or in a shape this can parse —
 * callers treat null as "skip this club", not an error.
 */

import { fetchWikitext, parseNameCell, deriveLastName } from './wikipedia.js';

export interface ManagerStint {
  fullName: string;
  lastName: string;
  /** Raw date text as Wikipedia wrote it (for logging/debugging only). */
  from: string;
  /** null = still in charge ("Present" in the table) — the most recent stint. */
  to: string | null;
  caretaker: boolean;
}

/**
 * Candidate page titles for a club's managerial history, most likely first.
 * NOT guaranteed real — Wikipedia isn't consistent about the "F.C." in the
 * dedicated-list-page family (confirmed: Arsenal's is "List of Arsenal F.C.
 * managers", Manchester United's is "List of Manchester United managers" —
 * no F.C.), and some clubs (confirmed: Brighton & Hove Albion) have no
 * dedicated list page at all — the table lives in a "==Managers==" section
 * of the MAIN club article instead. The caller tries each until one
 * actually fetches AND parses into a usable table.
 */
export function managersPageTitles(clubFullName: string): string[] {
  const withoutFc = clubFullName.replace(/\s*F\.?C\.?$/i, '').trim();
  const withFc = /F\.?C\.?$/i.test(clubFullName) ? clubFullName : `${clubFullName} F.C.`;
  const dedicated = [...new Set([withFc, withoutFc])].map(
    (t) => `List_of_${t.replace(/\s+/g, '_')}_managers`,
  );
  return [...dedicated, withFc.replace(/\s+/g, '_')];
}

/**
 * Parse the date text inside a {{dts|...}} template. Handles both
 * conventions seen: a single positional date string ("30 March 1897"), and
 * `format=dmy` with positional Y/M/D (some empty for an uncertain date) —
 * joined back into a parseable-enough string either way.
 */
function parseDtsDate(template: string): string | null {
  const m = template.match(/\{\{dts\s*\|([^}]*)\}\}/i);
  if (!m) return null;
  const positional = m[1]
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s && !s.includes('='));
  return positional.length ? positional.join('-') : null;
}

/** As a last resort, pull just a plausible year out of freeform date text —
 *  good enough for chronological ORDERING even when the exact day is fuzzy. */
export function parseWikiDateMs(text: string): number | null {
  const full = Date.parse(text);
  if (!Number.isNaN(full)) return full;
  const year = text.match(/\b(1[89]\d{2}|20\d{2})\b/);
  return year ? Date.UTC(Number(year[1]), 0, 1) : null;
}

/**
 * A From/To cell, in EITHER of the conventions seen: wrapped in {{dts}}, or
 * bare date text (Sheffield United wraps only From in {{dts}}, leaving To as
 * plain text).
 *
 * `kind: 'present'` = explicitly ongoing (the cell literally says "Present").
 * `kind: 'empty'` = no date AND no "Present" — genuinely AMBIGUOUS on its
 * own: it means "still in charge" for the table's last (most recent) row,
 * but "departure date just isn't recorded" for an old historical row (a real
 * pattern — Wikipedia often doesn't know exactly when a manager from the
 * 1920s left). Confirmed this ambiguity produced WRONG data before this fix:
 * an old row's blank cell got read as "ongoing", sorting a decades-dead
 * managerial spell to the top of "most recent". Resolving 'empty' correctly
 * requires row-POSITION context this function doesn't have — see
 * parseOneTable, which only treats it as ongoing for the table's actual last
 * row.
 */
function cellDateInfo(cell: string): { kind: 'date'; text: string } | { kind: 'present' | 'empty' } {
  // Strip the leading "|", then any cell-attribute prefix before the actual
  // content — e.g. "|align=left|9 January 2025" — MediaWiki separates a
  // cell's attributes from its content with their own "|", so there can be
  // one of these before the real value.
  // The unquoted-value branch is [^|]+ (NOT \S+) — an attribute value ends at
  // the first "|" in real MediaWiki syntax, and \S+ would happily cross it
  // and eat into the actual content (confirmed: it ate into a {{dts|...}}
  // template this way on a real page before this fix).
  const trimmed = cell
    .replace(/^\|+/, '')
    .trim() // must trim before the attribute-strip below: its ^ anchor needs
    // the letter at position 0, and a cell like "| align=left|..." leaves a
    // leading space after stripping just the pipe (confirmed this let a
    // whole "align=..." prefix leak through into a displayed date once).
    .replace(/^[a-zA-Z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^|]+)\s*\|/, '')
    .trim();
  // Try {{dts|...}} FIRST — it's self-contained (its own regex stops at its
  // own closing "}}"), so it's correct regardless of what citation/footnote
  // junk might trail after it in the cell.
  const dts = parseDtsDate(trimmed);
  if (dts) return { kind: 'date', text: dts };
  // Otherwise, drop anything from the first "{{" onward — a citation or
  // footnote template (confirmed: {{efn|...}} on a real page had "present"
  // somewhere in its own explanatory PROSE, which got misread as the cell
  // itself saying the manager's tenure was ongoing; the real content was a
  // plain date — "8 May 1933{{efn|...}}" — sitting right before it).
  const braceAt = trimmed.indexOf('{{');
  const core = (braceAt === -1 ? trimmed : trimmed.slice(0, braceAt)).trim();
  if (/\bpresent\b/i.test(core)) return { kind: 'present' };
  if (!core) return { kind: 'empty' };
  const stripped = core.replace(/<ref[^>]*\/?>(?:[\s\S]*?<\/ref>)?/gi, '').trim();
  return stripped ? { kind: 'date', text: stripped } : { kind: 'empty' };
}

/** A cell that resolved to a filename ("File:Foo.jpg") rather than a person —
 *  some clubs' tables have a leading Image column, and parseNameCell's
 *  wikilink fallback would otherwise happily "extract" it as if it were a name. */
function looksLikeFileRef(s: string): boolean {
  return /^file:/i.test(s) || /\.(jpe?g|png|svg|gif)$/i.test(s);
}

interface Candidate {
  fullName: string;
  fromText: string;
  toInfo: ReturnType<typeof cellDateInfo>;
  caretaker: boolean;
}

/** Every block in ONE table that resolves to a real manager row (name + a
 *  parseable From date). Doesn't decide "who's ongoing" — see
 *  parseManagersTable, which needs to see candidates from every table on the
 *  page before it can answer that. */
function candidateRows(table: string): Candidate[] {
  const out: Candidate[] = [];
  for (const block of table.split(/\n\|-/)) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    // The name cell isn't consistently marked `!scope="row"` across clubs —
    // some just use a plain "|" cell (confirmed: West Bromwich Albion) — so
    // find it by content instead: whichever line carries a {{sortname}}/
    // {{sort|}} template. Deliberately NOT falling back to "any cell that
    // looks like a name" — tried that, and it false-matched a kit-sponsor
    // table on one club's page and a numbered-list table on another's,
    // producing confidently WRONG "managers". {{sortname}}/{{sort|}} is
    // specific enough to person-name cells that this table family doesn't
    // need a looser fallback; a club whose table doesn't use it just isn't
    // parseable by this script, which is the correct outcome (skip, not guess).
    const nameLineIdx = lines.findIndex((l) => /\{\{sort(?:name)?\s*\|/i.test(l));
    if (nameLineIdx === -1) continue;
    const fullName = parseNameCell(lines[nameLineIdx]);
    if (!fullName || looksLikeFileRef(fullName)) continue;

    // Cells after the name, in column order: Nationality, From, To, ... —
    // lines starting with "!" (an Image column, seen on some clubs' tables)
    // are naturally excluded, and this doesn't care whether a cell wraps its
    // date in {{dts}} or writes it as plain text (both conventions exist).
    const dataLines = lines.slice(nameLineIdx + 1).filter((l) => l.startsWith('|'));
    const fromInfo = cellDateInfo(dataLines[1] ?? '');
    if (fromInfo.kind !== 'date') continue; // can't place them in time at all — skip

    // Checked against the whole block, not just the name line: a caretaker
    // row's background marker can land on the `|-` row-separator itself
    // (confirmed: "|-bgcolor=lightgreen" — split() leaves "bgcolor=..." as
    // the start of the NEXT block, not attached to that row's name line).
    // Multiple real conventions seen across clubs, so check them all.
    const caretaker =
      /background\s*:/i.test(block) ||
      /bgcolor\s*=/i.test(block) ||
      /\{\{dagger/i.test(block) ||
      /\(interim\)/i.test(block) ||
      /\(caretaker\)/i.test(block);
    out.push({ fullName, fromText: fromInfo.text, toInfo: cellDateInfo(dataLines[2] ?? ''), caretaker });
  }
  return out;
}

/** Every top-level wikitable ({| ... \n|}) on the page, in source order. */
function extractTables(wikitext: string): string[] {
  const tables: string[] = [];
  const re = /\{\|[\s\S]*?\n\|\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wikitext)) !== null) tables.push(m[0]);
  return tables;
}

/** Whether a table actually looks like a managerial RECORD table (has a
 *  win/loss record per row), not just any table that happens to use
 *  {{sortname}} for names — a squad-listing table does too, but has no
 *  match-record columns. Filters those out before they can be merged in. */
function looksLikeManagersTable(table: string): boolean {
  return /\{\{WDL\|/i.test(table) || /win\s*%/i.test(table);
}

/**
 * Parse a club's managerial history. Merges candidate rows across EVERY
 * qualifying table on the page (not just the biggest one) — confirmed some
 * clubs split their history into more than one wikitable (Birmingham City:
 * an early-era table and a separate modern one), and treating each in
 * isolation broke "who's currently in charge": each table's own last row
 * looked ongoing independently, so an old table's Leslie-Knighton-from-1928
 * (whose departure date Wikipedia just never recorded) sorted to the top of
 * "most recent" alongside the real current manager.
 *
 * Resolving "ongoing" is therefore done ONCE, globally, after merging: among
 * candidates whose To cell was ambiguous (empty, not literal "Present" — see
 * cellDateInfo), only the one with the single LATEST From date across every
 * table can plausibly be the incumbent; every other empty-To row is
 * "departure date not recorded", not ongoing, and is dropped rather than
 * guessed at.
 */
export function parseManagersTable(wikitext: string): ManagerStint[] {
  const candidates = extractTables(wikitext)
    .filter(looksLikeManagersTable)
    .flatMap(candidateRows);
  if (!candidates.length) return [];

  const withFromMs = candidates.map((c) => ({ c, fromMs: parseWikiDateMs(c.fromText) }));
  const ambiguousToMs = withFromMs
    .filter((x) => x.c.toInfo.kind === 'empty' && x.fromMs != null)
    .map((x) => x.fromMs!);
  const latestAmbiguousFromMs = ambiguousToMs.length ? Math.max(...ambiguousToMs) : null;

  const stints: ManagerStint[] = [];
  for (const { c, fromMs } of withFromMs) {
    const ongoing =
      c.toInfo.kind === 'present' ||
      (c.toInfo.kind === 'empty' && fromMs != null && fromMs === latestAmbiguousFromMs);
    if (!ongoing && c.toInfo.kind !== 'date') continue; // no departure date AND not ongoing — unparseable
    stints.push({
      fullName: c.fullName,
      lastName: deriveLastName(c.fullName),
      from: c.fromText,
      to: ongoing ? null : c.toInfo.kind === 'date' ? c.toInfo.text : null,
      caretaker: c.caretaker,
    });
  }
  return stints;
}

export interface ManagersHistory {
  stints: ManagerStint[];
  /** Which candidate title actually resolved — for an accurate source link. */
  pageTitle: string;
}

/** Fetch + parse one club's managerial history. Returns null (not an
 *  exception) if no candidate page exists, or none parses into a usable
 *  table — callers skip the club in that case. */
export async function fetchManagersHistory(clubFullName: string): Promise<ManagersHistory | null> {
  for (const title of managersPageTitles(clubFullName)) {
    let wikitext: string;
    try {
      wikitext = await fetchWikitext(title);
    } catch {
      continue; // this candidate title doesn't exist — try the next
    }
    const stints = parseManagersTable(wikitext);
    if (stints.length) return { stints, pageTitle: title };
  }
  return null;
}
