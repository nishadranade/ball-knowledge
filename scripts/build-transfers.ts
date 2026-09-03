/**
 * Generate "top 5 most expensive players {club} have signed" LIST questions
 * from Wikipedia's per-club "records and statistics" pages (see
 * fetch/wikiTransfers.ts for the parser and the real format inconsistencies
 * found across the clubs that have this table at all).
 *
 * This is the sparsest of the four new question types: most clubs don't
 * have a clean "Highest transfer fees paid" table (a survey before building
 * this found roughly a fifth of clubs checked do — unsurprisingly, the
 * richer/more transfer-active ones), and unlike managers, there's no
 * fallback page to try — a club either has this table or it doesn't. Same
 * caution as managers: validate and skip rather than guess.
 *
 * Run: npm run build:transfers
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readBankFile, writeBankFile, bankSizes, BANK_FORMATS } from './bank.js';
import { fetchSeasons, COMPS } from './fetch/plFixtures.js';
import { fetchStandings, isSeasonComplete } from './fetch/plStandings.js';
import { fetchTransferRecords } from './fetch/wikiTransfers.js';
import { MAJOR_CLUBS } from './question-templates.js';
import type { Question, ListQuestion, ListAnswer } from '../src/game/types.js';

const OUT_DIR = 'public/data';
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const NOW = new Date().toISOString();
const WIKI_URL_BASE = 'https://en.wikipedia.org/wiki/';
/** Every id this script owns starts with this — see FOREIGN_LIST_PREFIXES in
 *  build-questions.ts, which must be kept in sync. */
const ID_PREFIX = 'list_premier_league_transfer_';
const TOP_N = 5;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Every club that's appeared in a complete PL season's table — the same
 *  universe build-club-history.ts/build-managers.ts draw from. */
async function allPlClubs(): Promise<string[]> {
  const seasons = await fetchSeasons(COMPS.PREMIER_LEAGUE);
  const names = new Set<string>();
  for (const season of seasons) {
    const standings = await fetchStandings(season);
    if (standings && isSeasonComplete(standings)) {
      for (const e of standings.entries) names.add(e.team);
    }
  }
  return [...names].sort();
}

interface RecordLike {
  playerName: string;
  playerLastName: string;
  feeMillions: number;
}

function buildQuestion(club: string, sourcePage: string, records: RecordLike[]): ListQuestion | null {
  const sorted = [...records].sort((a, b) => b.feeMillions - a.feeMillions);
  if (sorted.length < TOP_N) return null;
  const cutoff = sorted[TOP_N - 1].feeMillions;
  const kept = sorted.filter((p) => p.feeMillions >= cutoff);
  // A club-record signing repeated (e.g. re-signed at a higher fee later) is
  // real but would make an odd "top 5 distinct players" answer set — require
  // distinct names, same guard as the all-time club-history top-N questions.
  if (new Set(kept.map((p) => p.playerName)).size !== kept.length) return null;

  const answers: ListAnswer[] = kept.map((p) => ({
    fullName: p.playerName,
    lastName: p.playerLastName,
    value: Math.round(p.feeMillions * 10) / 10, // keep one decimal (e.g. 106.8), drop float noise
  }));
  const isMajor = MAJOR_CLUBS.has(club);
  return {
    id: `${ID_PREFIX}${slug(club)}`,
    category: 'PREMIER_LEAGUE',
    format: 'LIST',
    prompt: `Name the top ${TOP_N} most expensive players ${club} have signed.`,
    maxWrong: 3,
    difficulty: isMajor ? 'STANDARD' : 'HARD',
    source: { name: 'Wikipedia', url: `${WIKI_URL_BASE}${sourcePage}`, retrievedAt: NOW },
    answers,
  };
}

function validate(questions: ListQuestion[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const q of questions) {
    if (ids.has(q.id)) errors.push(`duplicate id ${q.id}`);
    ids.add(q.id);
    if (!q.id.startsWith(ID_PREFIX)) errors.push(`${q.id}: missing expected id prefix`);
    if (q.maxWrong !== 3) errors.push(`${q.id}: maxWrong should be 3`);
    if (q.answers.length < TOP_N) errors.push(`${q.id}: fewer than ${TOP_N} answers`);
    const names = q.answers.map((a) => a.fullName);
    if (new Set(names).size !== names.length) errors.push(`${q.id}: duplicate player in answers`);
    for (let i = 1; i < q.answers.length; i++) {
      if ((q.answers[i - 1].value ?? 0) < (q.answers[i].value ?? 0)) {
        errors.push(`${q.id}: answers not sorted by descending fee`);
      }
    }
    for (const a of q.answers) {
      if (!a.lastName) errors.push(`${q.id}: answer missing lastName`);
      if (!((a.value ?? 0) > 0)) errors.push(`${q.id}: answer with non-positive fee`);
    }
  }
  return errors;
}

async function main() {
  console.log('Finding every PL club to attempt...');
  const clubs = await allPlClubs();
  console.log(`  ${clubs.length} clubs`);

  const out: ListQuestion[] = [];
  let attempted = 0;
  let noTable = 0;
  let tooFew = 0;
  for (const club of clubs) {
    attempted++;
    const result = await fetchTransferRecords(club);
    if (!result) {
      noTable++;
      continue;
    }
    const q = buildQuestion(club, result.pageTitle, result.records);
    if (!q) {
      tooFew++;
      continue;
    }
    out.push(q);
  }
  console.log(`  ${out.length} usable / ${attempted} attempted (${noTable} no usable table, ${tooFew} too few/duplicate)`);

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
    manifest.transfersGeneratedAt = NOW;
    await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  } catch {
    console.warn('  (no manifest.json to update)');
  }

  console.log(`\nWrote ${out.length} transfer questions. Bank is now ${wholeBank.length} total:`);
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
