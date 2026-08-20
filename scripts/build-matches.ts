/**
 * Generate MATCH questions and merge them into public/data/questions.json.
 *
 * WHY THIS IS A SEPARATE SCRIPT, not part of build-questions.ts:
 * build-questions.ts rewrites questions.json wholesale, and its career stage
 * crawls Wikipedia player-by-player — slow, rate-limited, and (per the README)
 * only ever partially complete, so each run yields a slightly different career
 * set. Coupling matches to that would mean you couldn't refresh fixtures without
 * also reshuffling the career pool. This script therefore REPLACES only the
 * MATCH questions and leaves LIST and CAREER_PATH byte-identical.
 *
 * Which matches qualify:
 *  - Premier League, BIG vs BIG        — always; these are the marquee fixtures
 *  - Premier League, BIG vs non-big    — only if it was a 3+ goal game, OR the
 *                                        non-big side won (an upset is memorable
 *                                        however few goals it took)
 *  - Premier League, neither side big  — never
 *  - Champions League                  — knockout ties (the round is its own
 *                                        quality filter, and it avoids brittle
 *                                        matching on European club names)
 *  - all of the above additionally need at least MIN_SCORERS nameable scorer,
 *    which drops 0-0s and the freak game decided entirely by own goals.
 *
 * Run: npm run build:matches   (also chained into build:data)
 * Env: MATCH_SEASONS=n  limit to the n most recent seasons (default 15)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readBankFile, writeBankFile, bankSizes, BANK_FORMATS } from './bank.js';
import {
  COMPS,
  fetchSeasons,
  fetchSeasonFixtures,
  fetchFixtureDetail,
  type CompSeason,
  type FixtureSummary,
} from './fetch/plFixtures.js';
import { qualifies, roundLabel, difficultyFor, slug } from './fetch/matchFilters.js';
import type { CompsId } from './fetch/premierLeague.js';
import type { MatchQuestion, MatchScorer } from '../src/game/types.js';

const OUT_DIR = 'public/data';
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const NOW = new Date().toISOString();
const PL_SOURCE_URL = 'https://www.premierleague.com/results';

/** How many recent seasons to cover. */
const SEASONS = Number(process.env.MATCH_SEASONS ?? 15);
/** A question needs at least one nameable scorer. Since the score is shown, a
 *  1-0 with a single scorer is a perfectly fair question — but a 0-0, or a game
 *  whose only goal was an own goal, would have nothing to ask. */
const MIN_SCORERS = 1;

/** Which fixtures qualify at all (BIG_SIX, knockout-ties, etc.) lives in
 *  fetch/matchFilters.ts — shared with build-squads.ts so the two formats
 *  draw from the same "worth asking about" pool of games. */

/** Cheap pre-filter on the LIST response, before paying for the detail call.
 *  Own goals (type O) are not nameable scorers, so they don't count. */
function distinctScorersInSummary(f: FixtureSummary): number {
  return new Set(f.goals.filter((g) => g.type !== 'O').map((g) => g.personId)).size;
}

async function buildForCompetition(
  comps: CompsId,
  category: 'PREMIER_LEAGUE' | 'CHAMPIONS_LEAGUE',
): Promise<MatchQuestion[]> {
  const label = category === 'PREMIER_LEAGUE' ? 'Premier League' : 'Champions League';
  const seasons: CompSeason[] = (await fetchSeasons(comps)).slice(0, SEASONS);
  console.log(`\n${label}: ${seasons.length} seasons (${seasons.at(-1)?.label} … ${seasons[0]?.label})`);

  const out: MatchQuestion[] = [];
  let considered = 0;
  let thin = 0;
  let unresolved = 0;

  for (const season of seasons) {
    const fixtures = await fetchSeasonFixtures(comps, season);
    const candidates = fixtures.filter(
      (f) => qualifies(f, comps) && distinctScorersInSummary(f) >= MIN_SCORERS,
    );
    considered += fixtures.length;
    let kept = 0;

    for (const f of candidates) {
      const detail = await fetchFixtureDetail(f.id, comps);
      if (!detail) {
        unresolved++;
        continue;
      }
      // Re-check against the authoritative detail data; the summary's goals[]
      // can disagree with events[] on the odd fixture.
      if (detail.scorers.length < MIN_SCORERS) {
        thin++;
        continue;
      }
      const answers: MatchScorer[] = detail.scorers.map((s) => ({
        fullName: s.fullName,
        lastName: s.lastName,
        goals: s.goals,
        team: s.team,
      }));
      out.push({
        id: `match_${slug(category)}_${f.date}_${slug(f.homeTeam)}_${slug(f.awayTeam)}`,
        category,
        format: 'MATCH',
        prompt: 'Who scored in this match?',
        maxWrong: 3,
        difficulty: difficultyFor(f.date),
        source: {
          name: 'Premier League',
          url: PL_SOURCE_URL,
          retrievedAt: NOW,
        },
        match: {
          homeTeam: f.homeTeam,
          awayTeam: f.awayTeam,
          homeScore: f.homeScore,
          awayScore: f.awayScore,
          date: f.date,
          dateLabel: f.dateLabel,
          round: roundLabel(f),
        },
        answers,
        ownGoals: detail.ownGoals || undefined,
      });
      kept++;
    }
    console.log(`  ${season.label}: ${fixtures.length} fixtures → ${kept} questions`);
  }

  const std = out.filter((q) => q.difficulty === 'STANDARD').length;
  console.log(
    `  ${label} total: ${out.length} questions from ${considered} fixtures ` +
      `(${std} standard, ${out.length - std} hard; ${thin} too thin, ${unresolved} unresolved)`,
  );
  return out;
}

function validate(questions: MatchQuestion[]): string[] {
  const errors: string[] = [];
  for (const q of questions) {
    const { match, answers } = q;
    if (answers.length < MIN_SCORERS) errors.push(`${q.id}: only ${answers.length} scorers`);
    if (q.maxWrong !== 3) errors.push(`${q.id}: MATCH maxWrong should be 3`);
    for (const a of answers) {
      if (!a.lastName) errors.push(`${q.id}: scorer missing lastName`);
      if (!a.team) errors.push(`${q.id}: scorer missing team`);
      if (!(a.goals >= 1)) errors.push(`${q.id}: scorer with ${a.goals} goals`);
    }
    // The goals in the answer list plus own goals must equal the scoreline.
    // If this drifts, the question is simply wrong and must not ship.
    const tallied = answers.reduce((n, a) => n + a.goals, 0) + (q.ownGoals ?? 0);
    const scoreline = match.homeScore + match.awayScore;
    if (tallied !== scoreline) {
      errors.push(`${q.id}: ${tallied} goals accounted for but score is ${scoreline}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(match.date)) errors.push(`${q.id}: bad date ${match.date}`);
  }
  return errors;
}

async function main() {
  // Only the other formats' files are read — this script owns MATCH entirely and
  // rewrites that one file, so list/career/squad questions are never touched.
  // SQUAD is included here purely so the manifest recompute below (and the
  // duplicate-id check) stay accurate if this script is ever re-run standalone
  // after q-squad.json already exists.
  const existing = [
    ...(await readBankFile('LIST')),
    ...(await readBankFile('CAREER_PATH')),
    ...(await readBankFile('SQUAD')),
  ];
  console.log(`Existing bank: ${existing.length} list + career + squad questions`);

  const matches = [
    ...(await buildForCompetition(COMPS.PREMIER_LEAGUE, 'PREMIER_LEAGUE')),
    ...(await buildForCompetition(COMPS.CHAMPIONS_LEAGUE, 'CHAMPIONS_LEAGUE')),
  ];

  const errors = validate(matches);
  if (errors.length) {
    console.error(
      `\nVALIDATION ERRORS (${errors.length}):\n` +
        errors.slice(0, 25).map((e) => '  - ' + e).join('\n'),
    );
    process.exit(1);
  }

  // Ids must be unique across the WHOLE bank, not just among matches.
  const ids = new Set(existing.map((q) => q.id));
  for (const q of matches) {
    if (ids.has(q.id)) {
      console.error(`Duplicate id collides with the existing bank: ${q.id}`);
      process.exit(1);
    }
    ids.add(q.id);
  }

  await writeBankFile('MATCH', matches, NOW);
  const questions = [...existing, ...matches];

  // Keep the manifest's counts honest about what actually shipped.
  try {
    const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
    const byCategory: Record<string, number> = {};
    for (const q of questions) byCategory[q.category] = (byCategory[q.category] ?? 0) + 1;
    manifest.counts = {
      ...manifest.counts,
      total: questions.length,
      list: questions.filter((q) => q.format === 'LIST').length,
      career: questions.filter((q) => q.format === 'CAREER_PATH').length,
      match: matches.length,
      byCategory,
      byDifficulty: {
        STANDARD: questions.filter((q) => q.difficulty === 'STANDARD').length,
        HARD: questions.filter((q) => q.difficulty === 'HARD').length,
      },
    };
    manifest.matchesGeneratedAt = NOW;
    await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  } catch {
    console.warn('  (no manifest.json to update)');
  }

  console.log(`\nWrote ${matches.length} match questions. Bank is now ${questions.length} total:`);
  let totalBytes = 0;
  for (const { format, bytes } of await bankSizes()) {
    totalBytes += bytes;
    console.log(`  ${format.padEnd(12)} ${(bytes / 1e6).toFixed(2)} MB`);
  }
  console.log(
    `  ${'TOTAL'.padEnd(12)} ${(totalBytes / 1e6).toFixed(2)} MB across ${BANK_FORMATS.length} files ` +
      `— a visitor fetches only the ones their view needs.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
