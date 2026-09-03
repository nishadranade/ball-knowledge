import { describe, it, expect } from 'vitest';
import { parseTransferTable, transfersPageTitle } from '../scripts/fetch/wikiTransfers';

/**
 * Regression tests for real bugs found while building this against actual
 * club "records and statistics" pages — each fixture is a trimmed-down real
 * snippet, not a synthetic "ideal" case.
 */

describe('transfersPageTitle', () => {
  it('builds "List of X F.C. records and statistics"', () => {
    expect(transfersPageTitle('Chelsea')).toBe('List_of_Chelsea_F.C._records_and_statistics');
  });

  it('does not double up when the name already ends in "F.C."', () => {
    expect(transfersPageTitle('Chelsea F.C.')).toBe('List_of_Chelsea_F.C._records_and_statistics');
  });
});

describe('parseTransferTable — Chelsea-style rows (rank on its own line)', () => {
  const wikitext = `
====Highest transfer fees paid====
{| class="wikitable sortable" style="text-align: center;"
|-
!Rank!!Player!!From!!Fee<br>([[Pound sterling|£ million]])!!Year
|-
|1
|align="left"|{{flagicon|ARG}} [[Enzo Fernández]]||align="left"|{{fbaicon|POR}} [[S.L. Benfica|Benfica]]||£106.8<ref>{{Cite web |title=x}}</ref>||2023
|-
|2
|align="left"|{{flagicon|ECU}} [[Moisés Caicedo]]||align="left"|{{fbaicon|ENG}} [[Brighton & Hove Albion F.C.|Brighton & Hove Albion]]||£100{{efn|name=buyout|Initial £100 million plus £15 million in add-ons}}<ref>{{Cite web |title=y}}</ref>||2023
|}

===Next section===
`;

  it('extracts the player and selling club, ignoring the leading flag template', () => {
    const records = parseTransferTable(wikitext);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ playerName: 'Enzo Fernández', fromClub: 'Benfica', feeMillions: 106.8, year: 2023 });
  });

  it('does not let a trailing {{efn|...}} template swallow the fee (leading templates vs trailing ones)', () => {
    const records = parseTransferTable(wikitext);
    const caicedo = records.find((r) => r.playerName === 'Moisés Caicedo')!;
    expect(caicedo.feeMillions).toBe(100);
  });

  it('stops at the next section heading, not spilling into unrelated content', () => {
    const records = parseTransferTable(wikitext);
    expect(records.every((r) => r.year === 2023)).toBe(true);
  });
});

describe('parseTransferTable — Manchester United-style rows (rank on the SAME line)', () => {
  // Confirmed real bug: destructuring the first 4 "||"-cells without
  // checking for a leading bare-integer rank shifted every field by one
  // (fee became the player cell, etc.) for clubs using this row layout.
  const wikitext = `
====Highest transfer fees paid====
{| class="wikitable sortable"
|-
!Rank
!Player
!From
!Fee
!Date
|-
|1||{{flagicon|FRA}} [[Paul Pogba]]||{{flagicon|ITA}} [[Juventus FC|Juventus]]||£89.3&nbsp;million<ref name="a"/>||August 2016
|-
|2||{{flagicon|BRA}} [[Antony (footballer, born 2000)|Antony]]||{{flagicon|NED}} [[AFC Ajax|Ajax]]||£82&nbsp;million<ref name="b">{{cite news|title=x}}</ref>||September 2022
|}
`;

  it('drops the leading rank cell before destructuring the row', () => {
    const records = parseTransferTable(wikitext);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ playerName: 'Paul Pogba', fromClub: 'Juventus', feeMillions: 89.3, year: 2016 });
  });

  it('extracts the display name from a piped wikilink ([[real title|Antony]])', () => {
    const records = parseTransferTable(wikitext);
    expect(records[1].playerName).toBe('Antony');
  });

  it('pulls the year out of a "Month Year" date cell', () => {
    const records = parseTransferTable(wikitext);
    expect(records[1].year).toBe(2022);
  });
});

describe('parseTransferTable — Fulham-style rows (comma-grouped full fee figure)', () => {
  // Confirmed real bug: "£34,600,000" matched against the plain digits-after-
  // "£" regex alone silently truncated at the first comma, reporting £34m
  // instead of the real £34.6m.
  const wikitext = `
====Highest transfer fees paid====
{| class="wikitable sortable"
|-
!Rank!!Player!!From!!Fee!!Year
|-
|1
| align="left" |{{flagicon|BRA}} [[Kevin (footballer, born 2003)|Kevin]]|| align="left" |{{fbaicon|UKR}} [[FC Shakhtar Donetsk|Shakhtar Donetsk]]||£34,600,000||2025
|}
`;

  it('divides a comma-grouped full figure by 1e6, not truncating at the comma', () => {
    const records = parseTransferTable(wikitext);
    expect(records).toHaveLength(1);
    expect(records[0].feeMillions).toBe(34.6);
  });

  it('keeps a mononym player name intact (not treated as a truncation)', () => {
    expect(parseTransferTable(wikitext)[0].playerName).toBe('Kevin');
  });
});

describe('parseTransferTable — no section on the page', () => {
  it('returns an empty array rather than throwing', () => {
    expect(parseTransferTable('== Some other section ==\nNo transfers table here.')).toEqual([]);
  });
});
