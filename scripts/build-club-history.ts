/**
 * Generate "clubs as the answer" LIST questions from PL final-table history:
 * relegated clubs and promoted clubs (one question per season), plus
 * all-time top-N-finish questions (one per N in TOP_N_VALUES).
 *
 * Reuses the LIST format with club-shaped Player answers — fullName is the
 * full club name, lastName is the API's own club-specific short name (e.g.
 * "Man Utd", "Spurs", "Sheffield Utd" vs "Sheff Weds" — confirmed these are
 * already unambiguous per club, no manual alias curation needed), and
 * `noAutoTokens: true` so matching.ts doesn't derive standalone-word guesses
 * like "United" or "Manchester" that would ambiguously match several clubs
 * (see the noAutoTokens doc comment on Player in src/game/types.ts).
 *
 * Promoted/relegated are a straight set difference between two adjacent
 * seasons' tables — confirmed against real data that this naturally handles
 * the one era that wasn't the usual 3-down-3-up (1994/95 → 1995/96, when the
 * top flight shrank from 22 to 20 clubs: 4 relegated, only 2 promoted) with
 * no special-casing needed.
 *
 * Difficulty: relegated/promoted are recency-banded, same threshold and
 * reasoning as MATCH/SQUAD (STANDARD_WITHIN_YEARS in matchFilters.ts) — a
 * recent relegation is approachable, an old one is deep-cut trivia.
 * All-time top-N-finish questions are always HARD (cumulative history across
 * 30+ seasons is a different kind of question than "what happened recently").
 *
 * Run: npm run build:club-history
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readBankFile, writeBankFile, bankSizes, BANK_FORMATS } from './bank.js';
import { fetchSeasons, COMPS, type CompSeason } from './fetch/plFixtures.js';
import { fetchStandings, isSeasonComplete, type SeasonStandings, type StandingsEntry } from './fetch/plStandings.js';
import type { Difficulty, Question, ListQuestion, ListAnswer } from '../src/game/types.js';

const OUT_DIR = 'public/data';
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const NOW = new Date().toISOString();
const PL_SOURCE_URL = 'https://www.premierleague.com/tables';
/** Every id this script owns starts with this — see FOREIGN_LIST_PREFIXES in
 *  build-questions.ts, which must be kept in sync. */
const ID_PREFIX = 'list_premier_league_club_';
/** Same threshold as matchFilters.ts's STANDARD_WITHIN_YEARS, for the same
 *  reason: recency is a rough but decent proxy for how memorable this is. */
const STANDARD_WITHIN_YEARS = 5;
/** Which "finished in the top N" thresholds to generate. 1 gets special
 *  "won the league" wording; 2-4 are the classic Champions-League-era
 *  qualification lines fans actually talk about. */
const TOP_N_VALUES = [1, 2, 3, 4];

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function toClubAnswer(e: StandingsEntry, value?: number): ListAnswer {
  return { fullName: e.team, lastName: e.shortName, noAutoTokens: true, ...(value != null ? { value } : {}) };
}

/** Calendar year a season ENDS, e.g. "2023/24" -> 2024 — how fans actually
 *  refer to "the year" a relegation/promotion happened. */
function seasonEndYear(season: CompSeason): number {
  return season.startYear + 1;
}

function difficultyForSeason(season: CompSeason): Difficulty {
  const years = new Date().getUTCFullYear() - seasonEndYear(season);
  return years <= STANDARD_WITHIN_YEARS ? 'STANDARD' : 'HARD';
}

interface HistoryResult {
  questions: ListQuestion[];
  seasonsUsed: CompSeason[];
}

async function buildHistory(): Promise<HistoryResult> {
  console.log('Fetching PL season standings history...');
  const allSeasons = [...(await fetchSeasons(COMPS.PREMIER_LEAGUE))].reverse(); // oldest first
  const standingsById = new Map<number, SeasonStandings>();
  const seasons: CompSeason[] = [];
  for (const season of allSeasons) {
    const standings = await fetchStandings(season);
    if (standings && isSeasonComplete(standings)) {
      standingsById.set(season.id, standings);
      seasons.push(season);
    }
  }
  console.log(`  ${seasons.length} complete seasons: ${seasons[0]?.label} … ${seasons.at(-1)?.label}`);

  const out: ListQuestion[] = [];

  // Relegated / promoted, one question per adjacent-season pair.
  for (let i = 1; i < seasons.length; i++) {
    const prev = seasons[i - 1];
    const cur = seasons[i];
    const prevTeams = new Map(standingsById.get(prev.id)!.entries.map((e) => [e.team, e]));
    const curTeams = new Map(standingsById.get(cur.id)!.entries.map((e) => [e.team, e]));

    const relegated = [...prevTeams.values()].filter((e) => !curTeams.has(e.team));
    if (relegated.length) {
      out.push({
        id: `${ID_PREFIX}relegated_${slug(prev.label)}`,
        category: 'PREMIER_LEAGUE',
        format: 'LIST',
        prompt: `Name the club${relegated.length === 1 ? '' : 's'} relegated from the Premier League at the end of the ${prev.label} season.`,
        maxWrong: 3,
        difficulty: difficultyForSeason(prev),
        source: { name: 'Premier League', url: PL_SOURCE_URL, retrievedAt: NOW },
        // Final points total — self-explanatory alongside "relegated" and
        // more interesting than a bare final position would be.
        answers: relegated.map((e) => toClubAnswer(e, e.points)),
      });
    }

    const promoted = [...curTeams.values()].filter((e) => !prevTeams.has(e.team));
    if (promoted.length) {
      out.push({
        id: `${ID_PREFIX}promoted_${slug(cur.label)}`,
        category: 'PREMIER_LEAGUE',
        format: 'LIST',
        prompt: `Name the club${promoted.length === 1 ? '' : 's'} promoted to the Premier League for the ${cur.label} season.`,
        maxWrong: 3,
        difficulty: difficultyForSeason(cur),
        source: { name: 'Premier League', url: PL_SOURCE_URL, retrievedAt: NOW },
        answers: promoted.map((e) => toClubAnswer(e, e.points)),
      });
    }
  }

  // All-time top-N finishes: every club that has EVER finished position <= N.
  const firstLabel = seasons[0]?.label ?? '';
  for (const n of TOP_N_VALUES) {
    const clubs = new Map<string, StandingsEntry>();
    for (const season of seasons) {
      for (const e of standingsById.get(season.id)!.entries) {
        if (e.position <= n && !clubs.has(e.team)) clubs.set(e.team, e);
      }
    }
    const prompt =
      n === 1
        ? `Name every club that has won the Premier League since it began in ${firstLabel}.`
        : `Name every club that has finished in the top ${n} of the Premier League at least once since it began in ${firstLabel}.`;
    out.push({
      id: `${ID_PREFIX}topn_${n}`,
      category: 'PREMIER_LEAGUE',
      format: 'LIST',
      prompt,
      maxWrong: 3,
      difficulty: 'HARD',
      source: { name: 'Premier League', url: PL_SOURCE_URL, retrievedAt: NOW },
      answers: [...clubs.values()].map((e) => toClubAnswer(e)),
    });
  }

  return { questions: out, seasonsUsed: seasons };
}

function validate(questions: ListQuestion[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const q of questions) {
    if (ids.has(q.id)) errors.push(`duplicate id ${q.id}`);
    ids.add(q.id);
    if (!q.id.startsWith(ID_PREFIX)) errors.push(`${q.id}: missing expected id prefix`);
    if (q.maxWrong !== 3) errors.push(`${q.id}: maxWrong should be 3`);
    if (!q.answers.length) errors.push(`${q.id}: no answers`);
    const names = q.answers.map((a) => a.fullName);
    if (new Set(names).size !== names.length) errors.push(`${q.id}: duplicate club in answers`);
    for (const a of q.answers) {
      if (!a.lastName) errors.push(`${q.id}: answer missing lastName (short name)`);
      if (!a.noAutoTokens) errors.push(`${q.id}: club answer must set noAutoTokens`);
    }
  }
  return errors;
}

async function main() {
  const { questions: out, seasonsUsed } = await buildHistory();
  const relegated = out.filter((q) => q.id.includes('_relegated_')).length;
  const promoted = out.filter((q) => q.id.includes('_promoted_')).length;
  const topN = out.filter((q) => q.id.includes('_topn_')).length;
  console.log(`  ${relegated} relegated + ${promoted} promoted + ${topN} all-time top-N = ${out.length} questions`);

  const errors = validate(out);
  if (errors.length) {
    console.error(`\nVALIDATION ERRORS (${errors.length}):\n` + errors.slice(0, 25).map((e) => '  - ' + e).join('\n'));
    process.exit(1);
  }

  // Merge into q-list.json: replace only the slice this script owns.
  const existing = (await readBankFile('LIST')).filter((q) => !q.id.startsWith(ID_PREFIX));
  const ids = new Set(existing.map((q) => q.id));
  for (const q of out) {
    if (ids.has(q.id)) {
      console.error(`Duplicate id collides with the existing bank: ${q.id}`);
      process.exit(1);
    }
    ids.add(q.id);
  }
  const merged: Question[] = [...existing, ...out];
  await writeBankFile('LIST', merged, NOW);

  const wholeBank: Question[] = [
    ...merged,
    ...(await readBankFile('CAREER_PATH')),
    ...(await readBankFile('MATCH')),
    ...(await readBankFile('SQUAD')),
  ];
  try {
    const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
    const byCategory: Record<string, number> = {};
    for (const q of wholeBank) byCategory[q.category] = (byCategory[q.category] ?? 0) + 1;
    manifest.counts = {
      ...manifest.counts,
      total: wholeBank.length,
      list: merged.filter((q) => q.format === 'LIST').length,
      byCategory,
      byDifficulty: {
        STANDARD: wholeBank.filter((q) => q.difficulty === 'STANDARD').length,
        HARD: wholeBank.filter((q) => q.difficulty === 'HARD').length,
      },
    };
    manifest.clubHistoryGeneratedAt = NOW;
    manifest.clubHistorySeasons = `${seasonsUsed[0]?.label ?? ''} … ${seasonsUsed.at(-1)?.label ?? ''}`;
    await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  } catch {
    console.warn('  (no manifest.json to update)');
  }

  console.log(`\nWrote ${out.length} club-history questions. Bank is now ${wholeBank.length} total:`);
  let totalBytes = 0;
  for (const { format, bytes } of await bankSizes()) {
    totalBytes += bytes;
    console.log(`  ${format.padEnd(12)} ${(bytes / 1e6).toFixed(2)} MB`);
  }
  console.log(`  ${'TOTAL'.padEnd(12)} ${(totalBytes / 1e6).toFixed(2)} MB across ${BANK_FORMATS.length} files`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
