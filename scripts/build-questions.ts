/**
 * Answer-bank build pipeline.
 *
 *   fetch (Premier League API)  ->  aggregate to PlayerRow[]  ->  ranked bank
 *   ->  expand LIST templates & KEEP only feasible ones
 *   ->  build CAREER pool (notable players) & attach Wikipedia infobox careers
 *   ->  validate  ->  write public/data/questions.json + manifest.json
 *
 * LIST data comes from the PL official API (all-time, all players, correct
 * per-club/per-country totals). CAREER progression still comes from Wikipedia
 * infoboxes (the PL API has no career-history-outside-the-PL data).
 *
 * Run: npm run build:data
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readBankFile, writeBankFile } from './bank.js';
import { fetchWikitext, hasCached, parseCareerInfobox, type CareerStint } from './fetch/wikipedia.js';
import { fetchTeams, COMPS, type CompsId } from './fetch/premierLeague.js';
import { aggregateMetric, type PlayerRow } from './fetch/plAggregate.js';
import { fetchChampionsLeagueScorers, fetchChampionsLeagueAppearances } from './fetch/clScorers.js';
import {
  COUNTRIES,
  MAJOR_COUNTRIES,
  MAJOR_CLUBS,
  expandListTemplates,
  renderListPrompt,
  SUPPORTED_METRICS,
  METRIC_FLOOR,
  TIER_SIZES,
  type ListQuestionTemplate,
  type Metric,
  type Competition,
} from './question-templates.js';
import type { Difficulty } from '../src/game/types.js';
import type {
  Question,
  ListQuestion,
  CareerPathQuestion,
  ListAnswer,
} from '../src/game/types.js';

const OUT_DIR = 'public/data';
const NOW = new Date().toISOString();
const PL_SOURCE_URL = 'https://www.premierleague.com/stats';
/**
 * q-list.json is no longer owned by this script ALONE — build-season-stats.ts
 * (and, over time, other scripts) also contribute their own slice, the same
 * way build-matches.ts/build-squads.ts own MATCH/SQUAD entirely, just scoped
 * by id prefix instead of by format since they share LIST. Without this list,
 * a rerun of build-questions.ts would silently wipe those slices out from
 * under them, since it otherwise treats its own output as q-list.json's
 * complete contents. Keep in sync with each such script's own ID_PREFIX.
 */
const FOREIGN_LIST_PREFIXES = [
  'list_premier_league_stat_',
  'list_premier_league_club_',
  'list_premier_league_manager_',
];
/** Career-path difficulty bands, by a player's BEST rank across all metrics and
 *  competitions. STANDARD = famous (best rank ≤ this); HARD = rarer (best rank in
 *  (STANDARD_MAX, HARD_MAX]). Players past HARD_MAX are excluded (too obscure). */
const STANDARD_MAX_RANK = 200;
const HARD_MAX_RANK = 500;
/** How deep (×100 players) to pull each overall leaderboard. Must cover HARD_MAX_RANK. */
const OVERALL_DEPTH_PAGES = 5;

// ---------------------------------------------------------------------------
// Competitions to generate. Both use the pulselive API; CL has no usable
// per-club data (team ids are English-only), so it is overall + country only.
// ---------------------------------------------------------------------------
/** A Wikipedia-sourced metric override: an all-time fetcher + its source URL.
 *  Metrics with an override use Wikipedia (all-time, with names); metrics without
 *  fall back to the pulselive API (which for CL is limited to 2004/05+). */
interface WikiMetricSource {
  fetch: () => Promise<PlayerRow[]>;
  url: string;
}

interface CompetitionConfig {
  competition: Competition; // structurally identical to the Category union in types.ts
  compsId: CompsId;
  hasClubs: boolean;
  sourceName: string;
  sourceUrl: string;
  /** Per-metric all-time Wikipedia sources that override pulselive. */
  wikipediaMetrics?: Partial<Record<Metric, WikiMetricSource>>;
  /** Coverage disclosure for metrics still sourced from pulselive with a limited
   *  window (e.g. "since 2004/05" for CL). Applied only to non-Wikipedia metrics. */
  pulseliveEraNote?: string;
}

const WIKI_CL_SCORERS_URL = 'https://en.wikipedia.org/wiki/List_of_UEFA_Champions_League_top_scorers';
const WIKI_CL_APPS_URL =
  'https://en.wikipedia.org/wiki/List_of_footballers_with_100_or_more_UEFA_Champions_League_appearances';

const COMPETITIONS: CompetitionConfig[] = [
  {
    competition: 'PREMIER_LEAGUE',
    compsId: COMPS.PREMIER_LEAGUE,
    hasClubs: true,
    sourceName: 'Premier League',
    sourceUrl: PL_SOURCE_URL,
  },
  {
    competition: 'CHAMPIONS_LEAGUE',
    compsId: COMPS.CHAMPIONS_LEAGUE,
    hasClubs: false,
    sourceName: 'Premier League',
    sourceUrl: PL_SOURCE_URL,
    // Goals + appearances are all-time from Wikipedia (with names). Assists and
    // clean sheets have no clean all-time source, so they stay on pulselive
    // (2004/05+) and keep the era disclosure.
    wikipediaMetrics: {
      goals: { fetch: fetchChampionsLeagueScorers, url: WIKI_CL_SCORERS_URL },
      appearances: { fetch: fetchChampionsLeagueAppearances, url: WIKI_CL_APPS_URL },
    },
    pulseliveEraNote: 'since 2004/05',
  },
];

// ---------------------------------------------------------------------------
// Nationality: map the PL API's country string (e.g. "Ireland", "Cote D’Ivoire")
// to our canonical display name (e.g. "Republic of Ireland", "Ivory Coast"),
// which is what a template's country scopeValue uses. Countries whose API string
// matches their display name need no override; others carry `apiName`.
// ---------------------------------------------------------------------------
const API_NAME_TO_DISPLAY = new Map<string, string>(
  COUNTRIES.map((c) => [c.apiName ?? c.name, c.name] as const),
);

function canonicalCountry(nat: string | null): string | null {
  if (!nat) return null;
  return API_NAME_TO_DISPLAY.get(nat) ?? null;
}

// ---------------------------------------------------------------------------
// Answer bank: metric -> PlayerRow[] from the Premier League API
// ---------------------------------------------------------------------------
interface AnswerBank {
  cfg: CompetitionConfig;
  byMetric: Map<Metric, PlayerRow[]>;
  clubs: string[]; // club names for per-club questions (empty for CL)
}

async function buildAnswerBank(cfg: CompetitionConfig): Promise<AnswerBank> {
  // Clubs only apply to competitions with usable per-club data (PL).
  const teams = cfg.hasClubs ? await fetchTeams() : [];
  if (cfg.hasClubs) console.log(`  ${teams.length} clubs`);
  const byMetric = new Map<Metric, PlayerRow[]>();
  for (const metric of SUPPORTED_METRICS) {
    // Metrics with an all-time Wikipedia source (CL goals + appearances) use it
    // instead of pulselive (which for CL only has 2004/05+, undercounting older
    // players like Crespo/Maldini). Assists/clean sheets have no such source.
    const wiki = cfg.wikipediaMetrics?.[metric];
    if (wiki) {
      const rows = await wiki.fetch();
      byMetric.set(metric, rows);
      console.log(`  bank[${cfg.competition}/${metric}] = ${rows.length} players (Wikipedia)`);
      continue;
    }
    const agg = await aggregateMetric(metric, teams, OVERALL_DEPTH_PAGES, cfg.compsId);
    byMetric.set(metric, agg.rows);
    console.log(`  bank[${cfg.competition}/${metric}] = ${agg.rows.length} players`);
  }
  return { cfg, byMetric, clubs: teams.map((t) => t.name) };
}

// ---------------------------------------------------------------------------
// LIST question generation
// ---------------------------------------------------------------------------

function toAnswer(row: PlayerRow, value: number, rank: number): ListAnswer {
  return { fullName: row.fullName, lastName: row.lastName, value, rank };
}

/** All players who qualify for a template (clear the metric floor), sorted by
 *  value descending. The pipeline then slices this to a tiered size. */
function qualifiersForTemplate(
  t: ListQuestionTemplate,
  bank: AnswerBank,
): { row: PlayerRow; value: number }[] {
  let rows = bank.byMetric.get(t.metric);
  if (!rows) return [];

  // Clean sheets are a goalkeeping stat: the PL API credits a clean sheet to
  // every player on the pitch, so restrict this metric to goalkeepers.
  if (t.metric === 'cleanSheets') {
    rows = rows.filter((r) => r.position === 'G');
  }

  let ranked: { row: PlayerRow; value: number }[];
  if (t.scopeType === 'overall') {
    ranked = rows.map((r) => ({ row: r, value: r.value }));
  } else if (t.scopeType === 'country') {
    ranked = rows
      .filter((r) => canonicalCountry(r.nationality) === t.scopeValue)
      .map((r) => ({ row: r, value: r.value }));
  } else {
    // club scope: value is the player's count AT that club (from the per-club split)
    ranked = [];
    for (const r of rows) {
      const split = r.clubs.find((c) => c.club === t.scopeValue);
      if (split) ranked.push({ row: r, value: split.count });
    }
  }

  // Apply the per-metric floor: a player only counts if their value meets the
  // minimum (e.g. ≥10 goals, ≥5 assists). This drops weak tail answers.
  const floor = METRIC_FLOOR[t.metric];
  ranked = ranked.filter((x) => x.value >= floor);
  ranked.sort((a, b) => b.value - a.value);
  return ranked;
}

/** Build the answer slice for a chosen size, expanding to include ties at the
 *  boundary (everyone whose value ≥ the Nth value). */
function sliceAnswers(ranked: { row: PlayerRow; value: number }[], topN: number): ListAnswer[] {
  const cutoff = ranked[topN - 1].value;
  const kept = ranked.filter((x) => x.value >= cutoff);
  return kept.map((x, i) => toAnswer(x.row, x.value, i + 1));
}

/** Difficulty + max list size for a LIST scope.
 *  - overall: STANDARD, full 10→5→3.
 *  - country/club: STANDARD + full tiering if it's a MAJOR nation/club; otherwise
 *    HARD-only and capped at top 5 (so its obscure rank 6–10 tail never shows in
 *    Standard mode, and it asks a shorter list). */
function listTier(t: ListQuestionTemplate): { difficulty: Difficulty; maxSize: number } {
  if (t.scopeType === 'overall') return { difficulty: 'STANDARD', maxSize: Infinity };
  const isMajor =
    t.scopeType === 'country'
      ? MAJOR_COUNTRIES.has(t.scopeValue)
      : MAJOR_CLUBS.has(t.scopeValue);
  return isMajor
    ? { difficulty: 'STANDARD', maxSize: Infinity }
    : { difficulty: 'HARD', maxSize: 5 };
}

function buildListQuestions(bank: AnswerBank): ListQuestion[] {
  const out: ListQuestion[] = [];
  let attempted = 0;
  for (const t of expandListTemplates(bank.clubs, bank.cfg.competition)) {
    attempted++;
    const ranked = qualifiersForTemplate(t, bank);
    const { difficulty, maxSize } = listTier(t);
    // Tiered sizing: use the largest allowed size the qualifier pool supports;
    // drop the scope if fewer than the smallest tier qualify.
    const topN = TIER_SIZES.find((n) => n <= maxSize && ranked.length >= n);
    if (!topN) continue;

    const answers = sliceAnswers(ranked, topN);
    // id namespaced by competition so PL and CL questions never collide.
    const id = `list_${t.competition}_${t.metric}_${t.scopeType}_${t.scopeValue || 'all'}_${topN}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_');
    // Metrics with an all-time Wikipedia source are attributed to Wikipedia and
    // carry no era note; pulselive-sourced metrics get the coverage disclosure.
    const wiki = bank.cfg.wikipediaMetrics?.[t.metric];
    const source = wiki
      ? { name: 'Wikipedia', url: wiki.url, retrievedAt: NOW }
      : { name: bank.cfg.sourceName, url: bank.cfg.sourceUrl, retrievedAt: NOW };
    const eraNote = wiki ? undefined : bank.cfg.pulseliveEraNote;
    out.push({
      id,
      category: bank.cfg.competition,
      format: 'LIST',
      prompt: renderListPrompt(t, topN, eraNote),
      maxWrong: 3,
      difficulty,
      source,
      answers,
    });
  }
  const hard = out.filter((q) => q.difficulty === 'HARD').length;
  console.log(
    `  LIST[${bank.cfg.competition}]: kept ${out.length} / attempted ${attempted} (${out.length - hard} standard, ${hard} hard)`,
  );
  return out;
}

// ---------------------------------------------------------------------------
// CAREER-PATH question generation
// Pool = top-K players per metric (deduped). Look up each player's Wikipedia
// page (by full name) and parse the infobox career.
// ---------------------------------------------------------------------------

interface CareerCandidate {
  player: PlayerRow;
  category: Competition; // competition this player is drawn from (first bank that had them)
  bestRank: number; // best (lowest) rank across all metrics & competitions
  difficulty: 'STANDARD' | 'HARD';
}

/** Career pool, difficulty-banded. A player's rarity = their BEST rank across
 *  all metrics and competitions (elite in any one dimension = famous). Players
 *  with best rank ≤ STANDARD_MAX_RANK are STANDARD; (STANDARD_MAX, HARD_MAX] are
 *  HARD; beyond HARD_MAX are dropped. `category` is the first competition the
 *  player appears in (banks are PL-first). Only rows carrying an overall rank
 *  count (club-only rows have rank=null and can't be placed on the fame scale). */
function careerPool(banks: AnswerBank[]): CareerCandidate[] {
  const best = new Map<string, { player: PlayerRow; category: Competition; rank: number }>();
  for (const bank of banks) {
    for (const rows of bank.byMetric.values()) {
      for (const r of rows) {
        if (r.rank == null) continue;
        const cur = best.get(r.fullName);
        if (!cur || r.rank < cur.rank) {
          best.set(r.fullName, {
            player: r,
            category: cur?.category ?? bank.cfg.competition,
            rank: r.rank,
          });
        }
      }
    }
  }
  const out: CareerCandidate[] = [];
  for (const { player, category, rank } of best.values()) {
    if (rank > HARD_MAX_RANK) continue;
    out.push({
      player,
      category,
      bestRank: rank,
      difficulty: rank <= STANDARD_MAX_RANK ? 'STANDARD' : 'HARD',
    });
  }
  return out;
}

async function buildCareerQuestions(banks: AnswerBank[]): Promise<CareerPathQuestion[]> {
  // CACHE_ONLY=1 → use only players whose Wikipedia page is already cached (no
  // live fetches). Lets us ship immediately from a partial crawl; a later full
  // run fills in the rest.
  const cacheOnly = process.env.CACHE_ONLY === '1';
  const pool = careerPool(banks);
  const std = pool.filter((c) => c.difficulty === 'STANDARD').length;
  console.log(
    `  CAREER pool = ${pool.length} players (${std} standard, ${pool.length - std} hard)${
      cacheOnly ? ' [CACHE_ONLY]' : ''
    }`,
  );
  const out: CareerPathQuestion[] = [];
  for (const { player: p, category, difficulty, bestRank } of pool) {
    const pageTitle = p.fullName.replace(/ /g, '_');
    if (cacheOnly && !(await hasCached(pageTitle))) continue; // skip uncached without fetching
    let career: CareerStint[];
    try {
      const wt = await fetchWikitext(pageTitle);
      career = parseCareerInfobox(wt);
    } catch (e) {
      console.warn(`    ! skip ${p.fullName}: ${(e as Error).message}`);
      continue;
    }
    // Need at least 2 clubs to make a meaningful career-path puzzle.
    if (career.length < 2) {
      console.warn(`    ! skip ${p.fullName}: only ${career.length} career stint(s)`);
      continue;
    }
    out.push({
      id: `career_${pageTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      category,
      format: 'CAREER_PATH',
      prompt: 'Which player had this career?',
      maxWrong: 2,
      difficulty,
      bestRank,
      source: {
        name: 'Wikipedia',
        url: `https://en.wikipedia.org/wiki/${pageTitle}`,
        retrievedAt: NOW,
      },
      career,
      // Career answers are generous: accept any significant name token, since
      // many players (esp. Brazilian/mononym) are commonly known by their first
      // name (e.g. "Alisson", "Ederson") rather than the derived surname.
      answer: {
        fullName: p.fullName,
        lastName: p.lastName,
        aliases: p.fullName.split(/\s+/).filter((t) => t.length >= 3),
      },
    });
  }
  console.log(`  CAREER: built ${out.length} questions`);
  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validate(questions: Question[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const q of questions) {
    if (ids.has(q.id)) errors.push(`duplicate id ${q.id}`);
    ids.add(q.id);
    // Every question (both formats) must carry a valid difficulty.
    if (q.difficulty !== 'STANDARD' && q.difficulty !== 'HARD') {
      errors.push(`${q.id}: invalid difficulty ${q.difficulty}`);
    }
    if (q.format === 'LIST') {
      if (q.maxWrong !== 3) errors.push(`${q.id}: LIST maxWrong should be 3`);
      if (!q.answers.length) errors.push(`${q.id}: no answers`);
      for (const a of q.answers) if (!a.lastName) errors.push(`${q.id}: answer missing lastName`);
    } else {
      if (q.maxWrong !== 2) errors.push(`${q.id}: CAREER maxWrong should be 2`);
      if (!q.answer.lastName) errors.push(`${q.id}: missing answer lastName`);
      if (q.career.length < 2) errors.push(`${q.id}: career too short`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Build one answer bank per competition, then LIST questions from each.
  const banks: AnswerBank[] = [];
  const listQs: ListQuestion[] = [];
  for (const cfg of COMPETITIONS) {
    console.log(`Building answer bank: ${cfg.competition}...`);
    const bank = await buildAnswerBank(cfg);
    banks.push(bank);
    listQs.push(...buildListQuestions(bank));
  }

  // Career questions draw from ALL competitions' pools (deduped by name).
  console.log('Generating career-path questions...');
  const careerQs = await buildCareerQuestions(banks);
  const questions: Question[] = [...listQs, ...careerQs];

  const errors = validate(questions);
  if (errors.length) {
    console.error('VALIDATION ERRORS:\n' + errors.map((e) => '  - ' + e).join('\n'));
    process.exit(1);
  }

  // Preserve any LIST entries owned by another script (see
  // FOREIGN_LIST_PREFIXES above) — this run's `listQs` is authoritative only
  // for ITS OWN ids, not for q-list.json's whole contents.
  const foreignList = (await readBankFile('LIST')).filter((q) =>
    FOREIGN_LIST_PREFIXES.some((p) => q.id.startsWith(p)),
  );
  const freshIds = new Set(listQs.map((q) => q.id));
  const idClash = foreignList.find((q) => freshIds.has(q.id));
  if (idClash) {
    console.error(`Foreign list id collides with a freshly-generated one: ${idClash.id}`);
    process.exit(1);
  }
  const finalListQs: Question[] = [...listQs, ...foreignList];
  const allQuestions: Question[] = [...finalListQs, ...careerQs];

  // Per-category counts for the manifest — across everything actually
  // shipping, foreign entries included.
  const byCategory: Record<string, number> = {};
  for (const q of allQuestions) byCategory[q.category] = (byCategory[q.category] ?? 0) + 1;
  const byDifficulty = {
    STANDARD: allQuestions.filter((q) => q.difficulty === 'STANDARD').length,
    HARD: allQuestions.filter((q) => q.difficulty === 'HARD').length,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  // The bank is split one file per format so the browser can fetch just what a
  // view needs (see scripts/bank.ts). This script owns LIST (minus any
  // foreign slice preserved above) and CAREER_PATH; build-matches.ts and
  // build-squads.ts own MATCH/SQUAD entirely and are left untouched here.
  await writeBankFile('LIST', finalListQs, NOW);
  await writeBankFile('CAREER_PATH', careerQs, NOW);
  await fs.writeFile(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        generatedAt: NOW,
        counts: {
          total: allQuestions.length,
          list: finalListQs.length,
          career: careerQs.length,
          byCategory,
          byDifficulty,
        },
        attribution:
          'LIST stats from the Premier League (premierleague.com), covering the Premier League and Champions League. Career paths from Wikipedia (CC BY-SA 4.0).',
        sources: [PL_SOURCE_URL, 'https://en.wikipedia.org'],
      },
      null,
      2,
    ),
  );
  console.log(
    `\nWrote ${listQs.length} list (+ ${foreignList.length} preserved from another script) + ` +
      `${careerQs.length} career questions to ${OUT_DIR}/q-list.json and q-career.json`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
