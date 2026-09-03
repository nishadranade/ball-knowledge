/**
 * Generate "last 3 managers of {club}" LIST questions from Wikipedia
 * managerial-history tables (see fetch/wikiManagers.ts for the parser and
 * the real format inconsistencies it had to handle across clubs — this page
 * family is NOT as consistently templated as career-path infoboxes are).
 *
 * Given that inconsistency, this validates aggressively per club and SKIPS
 * one entirely rather than ship a questionable "last 3" — same caution as
 * the transfer-fees plan (README roadmap): some clubs simply won't have this
 * question, rather than have it be wrong for them. A club only gets a
 * question if:
 *  - its table parsed at least 3 non-caretaker (permanent) stints,
 *  - the most recent permanent stint is the CURRENT manager (table looks
 *    stale/incomplete otherwise — "last 3" should include whoever's in
 *    charge now), and
 *  - each of the 3 has a sane from < to.
 *
 * Run: npm run build:managers
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readBankFile, writeBankFile, bankSizes, BANK_FORMATS } from './bank.js';
import { fetchSeasons, COMPS } from './fetch/plFixtures.js';
import { fetchStandings, isSeasonComplete } from './fetch/plStandings.js';
import { fetchManagersHistory, parseWikiDateMs, type ManagerStint } from './fetch/wikiManagers.js';
import { MAJOR_CLUBS } from './question-templates.js';
import type { Question, ListQuestion, ListAnswer } from '../src/game/types.js';

const OUT_DIR = 'public/data';
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const NOW = new Date().toISOString();
const WIKI_URL_BASE = 'https://en.wikipedia.org/wiki/';
/** Every id this script owns starts with this — see FOREIGN_LIST_PREFIXES in
 *  build-questions.ts, which must be kept in sync. */
const ID_PREFIX = 'list_premier_league_manager_';
const LAST_N = 3;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Every club that's appeared in a complete PL season's table — the same
 *  universe build-club-history.ts draws relegated/promoted/top-N from. */
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

interface RankedStint extends ManagerStint {
  /** epoch ms of `to`, or +Infinity for the ongoing (current) stint. */
  toMs: number;
}

/** Non-caretaker stints only, most recent first. Drops any stint whose dates
 *  don't parse — better to lose one entry than silently misorder the list. */
function recentPermanent(stints: ManagerStint[]): RankedStint[] {
  return stints
    .filter((s) => !s.caretaker)
    .map((s) => ({ ...s, toMs: s.to ? (parseWikiDateMs(s.to) ?? NaN) : Infinity }))
    .filter((s) => !Number.isNaN(s.toMs))
    .sort((a, b) => b.toMs - a.toMs);
}

function buildQuestion(club: string, sourcePage: string, stints: ManagerStint[]): ListQuestion | null {
  const sorted = recentPermanent(stints);
  if (sorted.length < LAST_N) return null;
  // The most recent permanent stint must be the CURRENT manager — otherwise
  // the table looks stale/incomplete relative to "now", and "last 3" would
  // silently omit whoever's actually in charge.
  if (sorted[0].toMs !== Infinity) return null;

  const last3 = sorted.slice(0, LAST_N);
  for (const s of last3) {
    const fromMs = parseWikiDateMs(s.from);
    if (fromMs == null) return null;
    if (s.toMs !== Infinity && fromMs >= s.toMs) return null; // from must precede to
  }
  // The 3 names must be distinct people, not the same manager's separate
  // stints counted twice (a real, common pattern — e.g. a returning legend).
  if (new Set(last3.map((s) => s.fullName)).size !== LAST_N) return null;

  const answers: ListAnswer[] = last3.map((s) => ({ fullName: s.fullName, lastName: s.lastName }));
  const isMajor = MAJOR_CLUBS.has(club);
  return {
    id: `${ID_PREFIX}${slug(club)}`,
    category: 'PREMIER_LEAGUE',
    format: 'LIST',
    prompt: `Name the last ${LAST_N} managers of ${club}.`,
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
    if (q.answers.length !== LAST_N) errors.push(`${q.id}: expected exactly ${LAST_N} answers`);
    const names = q.answers.map((a) => a.fullName);
    if (new Set(names).size !== names.length) errors.push(`${q.id}: duplicate manager in answers`);
    for (const a of q.answers) if (!a.lastName) errors.push(`${q.id}: answer missing lastName`);
  }
  return errors;
}

async function main() {
  console.log('Finding every PL club to attempt...');
  const clubs = await allPlClubs();
  console.log(`  ${clubs.length} clubs`);

  const out: ListQuestion[] = [];
  let attempted = 0;
  let noPage = 0;
  let tooFewOrStale = 0;
  for (const club of clubs) {
    attempted++;
    const history = await fetchManagersHistory(club);
    if (!history) {
      noPage++;
      continue;
    }
    const q = buildQuestion(club, history.pageTitle, history.stints);
    if (!q) {
      tooFewOrStale++;
      continue;
    }
    out.push(q);
  }
  console.log(
    `  ${out.length} usable / ${attempted} attempted (${noPage} no usable page, ${tooFewOrStale} too few/stale)`,
  );

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
    manifest.managersGeneratedAt = NOW;
    await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  } catch {
    console.warn('  (no manifest.json to update)');
  }

  console.log(`\nWrote ${out.length} manager questions. Bank is now ${wholeBank.length} total:`);
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
