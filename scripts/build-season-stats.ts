/**
 * Generate per-season PL "deep stat" LIST questions — shots, shots on
 * target, tackles, interceptions, saves — e.g. "Name the top 10 players
 * with the most shots on target in the Premier League in the 2020/21
 * season."
 *
 * Scoped to the most recent N *complete* seasons (default 10 — "complete"
 * meaning every club has played its full fixture list, checked against
 * fetch/plStandings.ts, so a season still in progress can't produce a
 * misleadingly-final "top 10"). Deliberately OVERALL only, no per-club/
 * per-country breakdown — that dimension already exists for the marquee
 * all-time metrics (goals/assists/appearances/clean sheets); adding it here
 * too would multiply into a huge number of thin, rarely-useful questions.
 *
 * STANDARD difficulty by design: unlike a minor club's obscure rank 6-10
 * tail, a season's top-10 shooters/tacklers/interceptors/savers are all
 * players who actually had a real Premier League season, and every season
 * covered is complete and recent (see recentCompleteSeasons below) — so
 * these are eligible for the daily list-question draw, not just Practice.
 * (Originally shipped HARD-only; promoted to STANDARD once the daily
 * rotation needed more list-question variety than the all-time metrics
 * alone provided.)
 *
 * This script owns a SLICE of q-list.json (every id starting with
 * `list_premier_league_stat_`), merging into whatever build-questions.ts
 * already put there rather than replacing the whole file — same pattern as
 * build-matches.ts/build-squads.ts owning their own format entirely, just
 * scoped by id prefix instead of by format, since this shares LIST with the
 * all-time metrics.
 *
 * Run: npm run build:season-stats
 * Env: SEASON_STATS_SEASONS=n  limit to the n most recent complete seasons (default 10)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readBankFile, writeBankFile, bankSizes, BANK_FORMATS } from './bank.js';
import { fetchSeasons, COMPS, type CompSeason } from './fetch/plFixtures.js';
import { fetchStandings, isSeasonComplete } from './fetch/plStandings.js';
import {
  fetchSeasonStat,
  SEASON_STAT_LABELS,
  SEASON_STAT_FLOOR,
  type SeasonStatMetric,
} from './fetch/plSeasonStats.js';
import type { Question, ListQuestion, ListAnswer } from '../src/game/types.js';

const OUT_DIR = 'public/data';
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const NOW = new Date().toISOString();
const PL_SOURCE_URL = 'https://www.premierleague.com/stats';

const SEASONS = Number(process.env.SEASON_STATS_SEASONS ?? 10);
const TOP_N = 10;
const METRICS: SeasonStatMetric[] = ['shots', 'shotsOnTarget', 'tackles', 'interceptions', 'saves'];
/** Every id this script owns starts with this — see the module comment. */
const ID_PREFIX = 'list_premier_league_stat_';

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** The most recent `count` COMPLETE seasons, oldest first (so logging reads
 *  chronologically). Walks back from the newest season until it finds enough
 *  that have actually finished. */
async function recentCompleteSeasons(count: number): Promise<CompSeason[]> {
  const all = await fetchSeasons(COMPS.PREMIER_LEAGUE); // newest first
  const out: CompSeason[] = [];
  for (const season of all) {
    if (out.length >= count) break;
    const standings = await fetchStandings(season);
    if (standings && isSeasonComplete(standings)) out.push(season);
  }
  return out.reverse();
}

async function buildForSeason(season: CompSeason): Promise<{ questions: ListQuestion[]; skipped: number }> {
  const out: ListQuestion[] = [];
  let skipped = 0;
  const seasonSlug = slug(season.label);
  for (const metric of METRICS) {
    const entries = await fetchSeasonStat(metric, season);
    const floor = SEASON_STAT_FLOOR[metric];
    const ranked = entries.filter((e) => e.value >= floor).sort((a, b) => b.value - a.value);
    if (ranked.length < TOP_N) {
      console.warn(`    ! skip ${metric} ${season.label}: only ${ranked.length} qualify (need ${TOP_N})`);
      skipped++;
      continue;
    }
    // Expand to include ties at the boundary, same convention as the
    // all-time LIST generator.
    const cutoff = ranked[TOP_N - 1].value;
    const kept = ranked.filter((e) => e.value >= cutoff);
    const answers: ListAnswer[] = kept.map((e, i) => ({
      fullName: e.fullName,
      lastName: e.lastName,
      value: e.value,
      rank: i + 1,
    }));
    out.push({
      id: `${ID_PREFIX}${slug(metric)}_${seasonSlug}_${TOP_N}`,
      category: 'PREMIER_LEAGUE',
      format: 'LIST',
      prompt: `Name the top ${TOP_N} players with the most ${SEASON_STAT_LABELS[metric]} in the Premier League in the ${season.label} season.`,
      maxWrong: 3,
      difficulty: 'STANDARD',
      source: { name: 'Premier League', url: PL_SOURCE_URL, retrievedAt: NOW },
      answers,
    });
  }
  return { questions: out, skipped };
}

function validate(questions: ListQuestion[]): string[] {
  const errors: string[] = [];
  for (const q of questions) {
    if (!q.id.startsWith(ID_PREFIX)) errors.push(`${q.id}: missing expected id prefix`);
    if (q.difficulty !== 'STANDARD') errors.push(`${q.id}: season stats should be STANDARD`);
    if (q.maxWrong !== 3) errors.push(`${q.id}: maxWrong should be 3`);
    if (q.answers.length < TOP_N) errors.push(`${q.id}: only ${q.answers.length} answers, expected ≥${TOP_N}`);
    for (const a of q.answers) {
      if (!a.lastName) errors.push(`${q.id}: answer missing lastName`);
      if (!((a.value ?? 0) > 0)) errors.push(`${q.id}: answer with non-positive value`);
    }
  }
  return errors;
}

async function main() {
  console.log(`Finding the ${SEASONS} most recent COMPLETE PL seasons...`);
  const seasons = await recentCompleteSeasons(SEASONS);
  console.log(`  using ${seasons.length}: ${seasons[0]?.label} … ${seasons.at(-1)?.label}`);

  const out: ListQuestion[] = [];
  let totalSkipped = 0;
  for (const season of seasons) {
    const { questions, skipped } = await buildForSeason(season);
    totalSkipped += skipped;
    out.push(...questions);
    console.log(`  ${season.label}: ${questions.length}/${METRICS.length} stat questions`);
  }

  const errors = validate(out);
  if (errors.length) {
    console.error(`\nVALIDATION ERRORS (${errors.length}):\n` + errors.slice(0, 25).map((e) => '  - ' + e).join('\n'));
    process.exit(1);
  }

  // Merge into q-list.json: replace only the slice this script owns, leaving
  // everything build-questions.ts put there untouched.
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

  // Recompute the manifest across the WHOLE bank (all four files), the same
  // way build-matches.ts/build-squads.ts do, so counts never go stale
  // relative to whichever script last ran.
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
    manifest.seasonStatsGeneratedAt = NOW;
    await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  } catch {
    console.warn('  (no manifest.json to update)');
  }

  console.log(
    `\nWrote ${out.length} season-stat questions (${totalSkipped} metric-seasons skipped, too thin). Bank is now ${wholeBank.length} total:`,
  );
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
