/**
 * Generate SQUAD questions (guess the starting XI) and write them to
 * public/data/q-squad.json. Practice-only for now — not part of the daily
 * selection yet (see loadQuestions.ts DAILY_FORMATS and CLAUDE.md).
 *
 * Draws from the same base fixture pool as build-matches.ts (big-team PL
 * games and CL knockouts — see fetch/matchFilters.ts qualifies()), PLUS one
 * extra restriction of its own: a CL fixture also needs a marquee side in it
 * (English big six or a continental heavyweight — isBigClFixture()). MATCH
 * questions don't apply that extra CL filter; SQUAD does, since naming a full
 * unfamiliar starting XI is a much bigger ask than naming a scorer. One side
 * per match is asked about, chosen deterministically (hashed from the
 * fixture, not Math.random) so re-running the build is reproducible.
 *
 * Run AFTER build-matches.ts when possible — fixture detail is disk-cached by
 * id, so a fixture MATCH already fetched costs nothing to fetch again here.
 *
 * Run: npm run build:squads   (also chained into build:data)
 * Env: SQUAD_SEASONS=n  limit to the n most recent seasons (default 15)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readBankFile, writeBankFile, bankSizes, BANK_FORMATS } from './bank.js';
import {
  COMPS,
  fetchSeasons,
  fetchSeasonFixtures,
  fetchFixtureSquads,
  type CompSeason,
  type FixtureSummary,
  type TeamSquad,
} from './fetch/plFixtures.js';
import {
  qualifies,
  isBigClFixture,
  isBigTeam,
  roundLabel,
  difficultyFor,
  slug,
} from './fetch/matchFilters.js';
import { hashString } from '../src/game/daily.js';
import type { CompsId } from './fetch/premierLeague.js';
import type { SquadQuestion, SquadPlayer } from '../src/game/types.js';

const OUT_DIR = 'public/data';
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const NOW = new Date().toISOString();
const PL_SOURCE_URL = 'https://www.premierleague.com/results';

/** How many recent seasons to cover. */
const SEASONS = Number(process.env.SQUAD_SEASONS ?? 15);

function toSquadQuestion(
  f: FixtureSummary,
  category: 'PREMIER_LEAGUE' | 'CHAMPIONS_LEAGUE',
  side: 'home' | 'away',
  squad: TeamSquad,
  opponent: string,
  teamScore: number,
  opponentScore: number,
): SquadQuestion {
  const answers: SquadPlayer[] = [];
  const lines: number[][] = [];
  for (const row of squad.lines) {
    const idxRow: number[] = [];
    for (const p of row) {
      idxRow.push(answers.length);
      answers.push({
        fullName: p.fullName,
        lastName: p.lastName,
        shirtNumber: p.shirtNumber,
        position: p.position,
      });
    }
    lines.push(idxRow);
  }
  return {
    id: `squad_${slug(category)}_${f.date}_${slug(f.homeTeam)}_${slug(f.awayTeam)}_${side}`,
    category,
    format: 'SQUAD',
    prompt: 'Name the starting XI.',
    maxWrong: 6,
    difficulty: difficultyFor(f.date),
    source: { name: 'Premier League', url: PL_SOURCE_URL, retrievedAt: NOW },
    squad: {
      team: squad.teamName,
      opponent,
      home: side === 'home',
      teamScore,
      opponentScore,
      date: f.date,
      dateLabel: f.dateLabel,
      round: roundLabel(f),
      formation: squad.formation,
    },
    answers,
    lines,
  };
}

async function buildForCompetition(
  comps: CompsId,
  category: 'PREMIER_LEAGUE' | 'CHAMPIONS_LEAGUE',
): Promise<SquadQuestion[]> {
  const label = category === 'PREMIER_LEAGUE' ? 'Premier League' : 'Champions League';
  const seasons: CompSeason[] = (await fetchSeasons(comps)).slice(0, SEASONS);
  console.log(`\n${label}: ${seasons.length} seasons (${seasons.at(-1)?.label} … ${seasons[0]?.label})`);

  const out: SquadQuestion[] = [];
  let considered = 0;
  let unresolved = 0;

  for (const season of seasons) {
    const fixtures = await fetchSeasonFixtures(comps, season);
    // CL gets the extra "actually a marquee side" filter SQUAD applies on top
    // of the shared qualifies() rule (see the module comment above).
    const candidates = fixtures.filter(
      (f) => qualifies(f, comps) && (comps === COMPS.PREMIER_LEAGUE || isBigClFixture(f)),
    );
    considered += fixtures.length;
    let kept = 0;

    for (const f of candidates) {
      const squads = await fetchFixtureSquads(f.id, comps);
      if (!squads) {
        unresolved++;
        continue;
      }
      // Prefer the recognizable side: if only one team in the fixture is
      // "big", always ask about ITS line-up, never the smaller/less familiar
      // side's (e.g. Bodø/Glimt vs Man City always asks Man City's XI). Only
      // when both sides are big — or, defensively, neither, though qualifies()
      // /isBigClFixture should never let that reach here — does it fall back
      // to a deterministic coin flip (hashed, not Math.random, so the build
      // stays reproducible).
      const homeBig = isBigTeam(f.homeTeam, comps);
      const awayBig = isBigTeam(f.awayTeam, comps);
      const side: 'home' | 'away' =
        homeBig && !awayBig
          ? 'home'
          : awayBig && !homeBig
            ? 'away'
            : hashString(`${f.date}_${f.homeTeam}_${f.awayTeam}`) % 2 === 0
              ? 'home'
              : 'away';
      const squad = side === 'home' ? squads.home : squads.away;
      out.push(
        toSquadQuestion(
          f,
          category,
          side,
          squad,
          side === 'home' ? f.awayTeam : f.homeTeam,
          side === 'home' ? f.homeScore : f.awayScore,
          side === 'home' ? f.awayScore : f.homeScore,
        ),
      );
      kept++;
    }
    console.log(`  ${season.label}: ${fixtures.length} fixtures → ${kept} squads`);
  }

  const std = out.filter((q) => q.difficulty === 'STANDARD').length;
  console.log(
    `  ${label} total: ${out.length} squads from ${considered} fixtures ` +
      `(${std} standard, ${out.length - std} hard; ${unresolved} unresolved)`,
  );
  return out;
}

function validate(questions: SquadQuestion[]): string[] {
  const errors: string[] = [];
  for (const q of questions) {
    if (q.answers.length !== 11) errors.push(`${q.id}: ${q.answers.length} answers, expected 11`);
    if (q.maxWrong !== 6) errors.push(`${q.id}: SQUAD maxWrong should be 6`);

    const flat = q.lines.flat();
    if (flat.length !== 11 || new Set(flat).size !== 11) {
      errors.push(`${q.id}: lines don't index exactly 11 distinct answers`);
    }
    for (const i of flat) {
      if (i < 0 || i >= q.answers.length) errors.push(`${q.id}: line index ${i} out of range`);
    }

    const nums = q.answers.map((a) => a.shirtNumber);
    if (new Set(nums).size !== nums.length) errors.push(`${q.id}: duplicate shirt numbers`);

    for (const a of q.answers) {
      if (!a.lastName) errors.push(`${q.id}: player missing lastName`);
      if (!(a.shirtNumber >= 1)) errors.push(`${q.id}: player with shirt number ${a.shirtNumber}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.squad.date)) errors.push(`${q.id}: bad date ${q.squad.date}`);

    // If exactly one side of the fixture is big, the question must be about
    // THAT side — never the smaller/less familiar one. (Both-big fixtures may
    // ask about either.)
    const comps = q.category === 'PREMIER_LEAGUE' ? COMPS.PREMIER_LEAGUE : COMPS.CHAMPIONS_LEAGUE;
    const teamBig = isBigTeam(q.squad.team, comps);
    const oppBig = isBigTeam(q.squad.opponent, comps);
    if (oppBig && !teamBig) {
      errors.push(`${q.id}: asks about the smaller side (${q.squad.team}) over the big one (${q.squad.opponent})`);
    }
  }
  return errors;
}

async function main() {
  // Only the other formats' files are read (for the id-uniqueness check) —
  // this script owns SQUAD entirely and rewrites that one file.
  const existing = [
    ...(await readBankFile('LIST')),
    ...(await readBankFile('CAREER_PATH')),
    ...(await readBankFile('MATCH')),
  ];
  console.log(`Existing bank: ${existing.length} list + career + match questions`);

  const squads = [
    ...(await buildForCompetition(COMPS.PREMIER_LEAGUE, 'PREMIER_LEAGUE')),
    ...(await buildForCompetition(COMPS.CHAMPIONS_LEAGUE, 'CHAMPIONS_LEAGUE')),
  ];

  const errors = validate(squads);
  if (errors.length) {
    console.error(
      `\nVALIDATION ERRORS (${errors.length}):\n` +
        errors.slice(0, 25).map((e) => '  - ' + e).join('\n'),
    );
    process.exit(1);
  }

  // Ids must be unique across the WHOLE bank, not just among squads.
  const ids = new Set(existing.map((q) => q.id));
  for (const q of squads) {
    if (ids.has(q.id)) {
      console.error(`Duplicate id collides with the existing bank: ${q.id}`);
      process.exit(1);
    }
    ids.add(q.id);
  }

  await writeBankFile('SQUAD', squads, NOW);
  const questions = [...existing, ...squads];

  // Keep the manifest's counts honest about what actually shipped — recomputed
  // across the WHOLE bank, the same way build-matches.ts does, so byCategory/
  // byDifficulty don't go stale relative to the new total.
  try {
    const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
    const byCategory: Record<string, number> = {};
    for (const q of questions) byCategory[q.category] = (byCategory[q.category] ?? 0) + 1;
    manifest.counts = {
      ...manifest.counts,
      total: questions.length,
      squad: squads.length,
      byCategory,
      byDifficulty: {
        STANDARD: questions.filter((q) => q.difficulty === 'STANDARD').length,
        HARD: questions.filter((q) => q.difficulty === 'HARD').length,
      },
    };
    manifest.squadsGeneratedAt = NOW;
    await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  } catch {
    console.warn('  (no manifest.json to update)');
  }

  console.log(`\nWrote ${squads.length} squad questions. Bank is now ${questions.length} total:`);
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
