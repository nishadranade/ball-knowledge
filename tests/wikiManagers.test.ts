import { describe, it, expect } from 'vitest';
import { parseManagersTable, managersPageTitles, parseWikiDateMs } from '../scripts/fetch/wikiManagers';

/**
 * Regression tests for real bugs found while building this against actual
 * Wikipedia pages — every fixture here is a trimmed-down real snippet (or a
 * faithful reconstruction of one), not a synthetic "ideal" case. This page
 * family turned out to be far less consistently templated than career-path
 * infoboxes are, and each fixture pins one specific format variant or one
 * specific bug that variant caused.
 */

const WDL = '{{WDL|100|50|20|30|for=150|against=100}}';

describe('parseManagersTable — Arsenal-style rows', () => {
  // {{dts}} for both dates, "Present" as plain text for the incumbent.
  const wikitext = `
==Managers==
{| class="wikitable"
|-
!scope="row" style=text-align:left|{{sortname|Arsène|Wenger}}
|align=left|{{flagu|France}}
|align=left|{{dts|1 October 1996}}
|align=left|{{dts|13 May 2018}}
${WDL}
|
|
|-
!scope="row" style=text-align:left|{{sortname|Unai|Emery}}
|align=left|{{flagu|Spain}}
|align=left|{{dts|23 May 2018}}
|align=left|{{dts|29 November 2019}}
${WDL}
|
|
|-
!scope="row" style=background:#B0C4DE|''{{sortname|Freddie|Ljungberg}}'' {{dagger|alt=caretaker}}
|align=left|{{flagu|Sweden}}
|align=left|{{dts|29 November 2019}}
|align=left|{{dts|20 December 2019}}
${WDL}
|
|
|-
!scope="row" style=text-align:left|{{sortname|Mikel|Arteta}}
|align=left|{{flagu|Spain}}
|align=left|{{dts|22 December 2019}}
|align=left|Present
${WDL}
|
|
|}
`;

  it('parses names, dates, and the incumbent (Present)', () => {
    const stints = parseManagersTable(wikitext);
    const permanent = stints.filter((s) => !s.caretaker);
    expect(permanent.map((s) => s.fullName)).toEqual(['Arsène Wenger', 'Unai Emery', 'Mikel Arteta']);
    const arteta = permanent.find((s) => s.fullName === 'Mikel Arteta')!;
    expect(arteta.to).toBeNull(); // Present -> ongoing
  });

  it('flags the {{dagger}} caretaker row and excludes it from permanent stints', () => {
    const stints = parseManagersTable(wikitext);
    const ljungberg = stints.find((s) => s.fullName === 'Freddie Ljungberg')!;
    expect(ljungberg.caretaker).toBe(true);
  });
});

describe('parseManagersTable — Manchester United-style rows', () => {
  // Extra Image column (a "!" cell, not "|"), {{dts|format=dmy|Y|M|D}} with
  // some positions empty for an uncertain date.
  const wikitext = `
==Statistics==
{| class="wikitable"
|-
! [[File:Ferguson.jpg]]
!scope="row"|{{sortname|Alex|Ferguson}}
|{{ENG}}
|{{dts|format=dmy|1986|11|6}}
|{{dts|format=dmy|2013|5|19}}
${WDL}
|
|
|-
! [[File:VanGaal.jpg]]
!scope="row"|{{sortname|Louis|van Gaal}}
|{{NED}}
|{{dts|format=dmy|2014||}}
|{{dts|format=dmy|2016|5|23}}
${WDL}
|
|
|-
! [[File:Amorim.jpg]]
!scope="row"|{{sortname|Ruben|Amorim}}
|{{POR}}
|{{dts|format=dmy|2024|11|11}}
|Present
${WDL}
|
|
|}
`;

  it("doesn't mistake the Image column's [[File:...]] link for a manager name", () => {
    const stints = parseManagersTable(wikitext);
    expect(stints.some((s) => /file:/i.test(s.fullName))).toBe(false);
    expect(stints.map((s) => s.fullName)).toEqual(['Alex Ferguson', 'Louis van Gaal', 'Ruben Amorim']);
  });

  it('parses a positional Y/M/D {{dts}} with some parts empty, into an orderable date', () => {
    const stints = parseManagersTable(wikitext);
    const vanGaal = stints.find((s) => s.fullName === 'Louis van Gaal')!;
    expect(parseWikiDateMs(vanGaal.from)).not.toBeNull();
    // Year-only precision is fine — just needs to sort correctly.
    expect(parseWikiDateMs(vanGaal.from)! < parseWikiDateMs(vanGaal.to!)!).toBe(true);
  });
});

describe('parseManagersTable — Sheffield United-style rows (plain-text To, empty = ongoing)', () => {
  // Only From is wrapped in {{dts}}; To is bare text; the incumbent's To cell
  // is simply EMPTY (not the word "Present").
  const wikitext = `
==Managers==
{| class="wikitable"
|-
!scope="row" align="left"|{{sort|Wilder, Chris|[[Chris Wilder]]}}
| {{flagicon|England}} England
| {{dts|12 May 2016}}
| 13 March 2021
| 227
| 106
${WDL}
|
|-
!scope="row" align="left"|{{sort|Heckingbottom, Paul|[[Paul Heckingbottom]]}} (interim)
| {{flagicon|England}} England
| {{dts|13 March 2021}}
| 27 May 2021
${WDL}
|
|-
!scope="row" align="left"|{{sort|Wilder, Chris|[[Chris Wilder]]}}
| {{flagicon|England}} England
| {{dts|15 September 2025}}
|
${WDL}
|
|}
`;

  it('treats a bare plain-text To cell (no {{dts}}) as a real date', () => {
    const stints = parseManagersTable(wikitext);
    const first = stints.find((s) => s.from === '12 May 2016')!;
    expect(first.to).toBe('13 March 2021');
  });

  it('treats an EMPTY To cell as ongoing only for the chronologically last row', () => {
    const stints = parseManagersTable(wikitext);
    const permanent = stints.filter((s) => !s.caretaker);
    const ongoing = permanent.filter((s) => s.to === null);
    expect(ongoing).toHaveLength(1);
    expect(ongoing[0].from).toBe('15 September 2025');
  });

  it('flags "(interim)" as caretaker', () => {
    const stints = parseManagersTable(wikitext);
    expect(stints.find((s) => s.fullName === 'Paul Heckingbottom')?.caretaker).toBe(true);
  });
});

describe('parseManagersTable — West Bromwich Albion-style rows (attribute-prefixed cells, bgcolor caretaker)', () => {
  const wikitext = `
==Managers and head coaches==
{| class="wikitable"
|-
| align=left|{{sortname|Tony|Mowbray}}
| {{flag|England}}
| align="left" |17 January 2025
| align="left" |21 April 2025
${WDL}
|
|
|-bgcolor=lightgreen
| align=left|{{sortname|James|Morrison}} (2nd Spell)
| {{flag|Scotland}}
| align=left|6 January 2026
| align=left|11 January 2026
${WDL}
|
|
|-
| align=left|{{sortname|Eric|Ramsay}}
|{{flag|Wales}}
| align="left" |11 January 2026
|Present
${WDL}
|
|
|}
`;

  it('name cells are found even without "scope=row" (a plain "|" cell)', () => {
    const stints = parseManagersTable(wikitext);
    expect(stints.map((s) => s.fullName)).toEqual(['Tony Mowbray', 'James Morrison', 'Eric Ramsay']);
  });

  it('strips an "align=left|" attribute prefix out of the date text (no raw wikitext leaking)', () => {
    const stints = parseManagersTable(wikitext);
    const mowbray = stints.find((s) => s.fullName === 'Tony Mowbray')!;
    expect(mowbray.from).toBe('17 January 2025');
    expect(mowbray.to).toBe('21 April 2025');
    expect(mowbray.from).not.toContain('align');
  });

  it('flags a "|-bgcolor=..." row-separator marker as caretaker (not attached to the name line itself)', () => {
    const stints = parseManagersTable(wikitext);
    expect(stints.find((s) => s.fullName === 'James Morrison')?.caretaker).toBe(true);
  });
});

describe('parseManagersTable — split across two tables (Birmingham City-style)', () => {
  // A page can have an EARLY-era table and a separate MODERN one. Each table
  // in isolation would see its own last row as "ongoing" — this pins that
  // resolving "who's current" happens ONCE, globally, across both tables.
  const wikitext = `
==History==
{| class="wikitable"
|-
| {{sortname|Leslie|Knighton}}
|English
|{{dts|1 July 1928}}
|8 May 1933{{efn|A note whose own prose happens to mention the word present in an unrelated sentence about the present-day club.}}
${WDL}
|
|
|}

==Managers==
{| class="wikitable"
|-
| {{sortname|Wayne|Rooney}}
|English
|{{dts|11 October 2023}}
|{{dts|2 January 2024}}
${WDL}
|
|
|-
| {{sortname|Tony|Mowbray}}
|English
|{{dts|8 January 2024}}
|{{dts|21 May 2024}}
${WDL}
|
|
|-
| {{sortname|Chris|Davies}}
|English
|{{dts|6 June 2024}}
|
${WDL}
|
|
|}
`;

  it('does not let an old table\'s row (with an unresolved departure date) look ongoing', () => {
    const stints = parseManagersTable(wikitext);
    const knighton = stints.find((s) => s.fullName === 'Leslie Knighton');
    // Either dropped entirely, or resolved to a real (non-null) date — never
    // null/"ongoing". This is the exact bug that shipped once: a citation
    // template's own prose contained the word "present", and got misread as
    // the cell itself saying "ongoing".
    expect(knighton?.to).not.toBeNull();
  });

  it('resolves "ongoing" to the single chronologically-latest row across BOTH tables', () => {
    const stints = parseManagersTable(wikitext);
    const ongoing = stints.filter((s) => s.to === null);
    expect(ongoing).toHaveLength(1);
    expect(ongoing[0].fullName).toBe('Chris Davies');
  });
});

describe('parseManagersTable — rejects a non-manager table', () => {
  // A squad-list (or similar) table can ALSO use {{sortname}} for names and
  // have date-shaped cells (e.g. a contract-until date) — it must not be
  // mistaken for the managers table just because it structurally resembles
  // one. The key discriminator: no win/loss record ({{WDL}} or a "Win %"
  // column), which every real managers table has and a squad list never does.
  const wikitext = `
==First-team squad==
{| class="wikitable"
|-
!scope="row"|{{sortname|Bukayo|Saka}}
|align=left|{{flagu|England}}
|align=left|{{dts|1 July 2019}}
|align=left|{{dts|30 June 2027}}
|
|-
!scope="row"|{{sortname|Declan|Rice}}
|align=left|{{flagu|England}}
|align=left|{{dts|1 July 2023}}
|Present
|
|}
`;

  it('finds nothing (no {{WDL}} / Win% signal anywhere on the page)', () => {
    expect(parseManagersTable(wikitext)).toEqual([]);
  });
});

describe('managersPageTitles', () => {
  it('tries the "F.C." form, the no-"F.C." form, then the main club page', () => {
    expect(managersPageTitles('Manchester United')).toEqual([
      'List_of_Manchester_United_F.C._managers',
      'List_of_Manchester_United_managers',
      'Manchester_United_F.C.',
    ]);
  });

  it('does not double up when the club name already ends in "F.C."', () => {
    const titles = managersPageTitles('Arsenal F.C.');
    expect(titles).toEqual(['List_of_Arsenal_F.C._managers', 'List_of_Arsenal_managers', 'Arsenal_F.C.']);
  });
});

describe('parseWikiDateMs', () => {
  it('parses a full date string', () => {
    expect(parseWikiDateMs('22 December 2019')).not.toBeNull();
  });

  it('falls back to a bare year when the full string does not parse', () => {
    const ms = parseWikiDateMs('1889-format=dmy garbage');
    expect(ms).toBe(Date.UTC(1889, 0, 1));
  });

  it('returns null for text with no recognisable date at all', () => {
    expect(parseWikiDateMs('no date here')).toBeNull();
  });

  it('sorts a 1928 date before a 2024 date', () => {
    expect(parseWikiDateMs('1 July 1928')! < parseWikiDateMs('6 June 2024')!).toBe(true);
  });
});
