/**
 * QUESTION TEMPLATE SPEC
 * =======================
 * This file is the single source of truth for WHAT questions the game can ask.
 * It is consumed by the data-prep pipeline (scripts/build-questions.ts) to
 * generate concrete Question objects (see src/game/types.ts) from the answer
 * bank. It does NOT contain answers — only the shape/parameters of questions.
 *
 * KEY IDEA: both question formats are derived from ONE dataset — a table of
 * players with their per-competition stats and attributes:
 *
 *     { name, nationality, position, clubs[], goals, assists, appearances, cleanSheets }
 *
 *  - LIST questions  = a query over that table (filter by scope, sort by metric, take topN).
 *  - CAREER questions = pick a "notable" player from that table, then attach the
 *                       career progression parsed from their Wikipedia infobox.
 */

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

/** Which stat a LIST question ranks players by. */
export type Metric = 'goals' | 'assists' | 'cleanSheets' | 'appearances';

/** Competition the stats are scoped to. Start with the Premier League; the
 *  model extends to Champions League and World Cup once those datasets exist. */
export type Competition = 'PREMIER_LEAGUE' | 'CHAMPIONS_LEAGUE' | 'WORLD_CUP';

/** A LIST question is scoped to the whole competition, one club, or one country. */
export type ScopeType = 'overall' | 'club' | 'country';

export type TopN = 3 | 5 | 10;

/**
 * Minimum stat value for a player to be a valid answer in a LIST question.
 * Players below the floor are excluded, and the question shrinks (10→5→3) or is
 * dropped if fewer than 3 players clear the floor. Prevents weak questions where
 * the tail answers have trivially few goals/assists.
 */
export const METRIC_FLOOR: Record<Metric, number> = {
  goals: 10,
  assists: 5,
  appearances: 50,
  cleanSheets: 10,
};

/** Question sizes to try, largest first (tiered 10 → 5 → 3). */
export const TIER_SIZES: TopN[] = [10, 5, 3];

/** Human-facing wording for each metric, used to render prompts. */
export const METRIC_LABELS: Record<Metric, { noun: string; positionHint?: string }> = {
  goals: { noun: 'goalscorers' },
  assists: { noun: 'assist providers' },
  cleanSheets: { noun: 'clean-sheet keepers', positionHint: 'goalkeepers' },
  appearances: { noun: 'appearance makers' },
};

export const COMPETITION_LABELS: Record<Competition, string> = {
  PREMIER_LEAGUE: 'Premier League',
  CHAMPIONS_LEAGUE: 'Champions League',
  WORLD_CUP: 'FIFA World Cup',
};

// ---------------------------------------------------------------------------
// Countries of "significant soccer relevance" (with demonyms for prompts).
// `apiName` is set ONLY when the Premier League API's country string differs
// from our display `name` (e.g. "Ireland" vs our "Republic of Ireland"). The
// pipeline matches players on apiName ?? name — a mismatch silently drops every
// player of that nation, so these must track the exact API strings.
// ---------------------------------------------------------------------------

export interface CountryScope {
  name: string; // display name used in prompts, e.g. "Ivory Coast"
  demonym: string; // adjective used in prompts, e.g. "German"
  apiName?: string; // PL API nationality string, if different from `name`
}

export const COUNTRIES: CountryScope[] = [
  // Europe
  { name: 'England', demonym: 'English' },
  { name: 'France', demonym: 'French' },
  { name: 'Germany', demonym: 'German' },
  { name: 'Spain', demonym: 'Spanish' },
  { name: 'Italy', demonym: 'Italian' },
  { name: 'Netherlands', demonym: 'Dutch' },
  { name: 'Portugal', demonym: 'Portuguese' },
  { name: 'Belgium', demonym: 'Belgian' },
  { name: 'Republic of Ireland', demonym: 'Irish', apiName: 'Ireland' },
  { name: 'Northern Ireland', demonym: 'Northern Irish' },
  { name: 'Scotland', demonym: 'Scottish' },
  { name: 'Wales', demonym: 'Welsh' },
  { name: 'Norway', demonym: 'Norwegian' },
  { name: 'Denmark', demonym: 'Danish' },
  { name: 'Sweden', demonym: 'Swedish' },
  { name: 'Croatia', demonym: 'Croatian' },
  { name: 'Serbia', demonym: 'Serbian' },
  { name: 'Czech Republic', demonym: 'Czech' },
  { name: 'Poland', demonym: 'Polish' },
  { name: 'Switzerland', demonym: 'Swiss' },
  { name: 'Austria', demonym: 'Austrian' },
  { name: 'Iceland', demonym: 'Icelandic' },
  { name: 'Finland', demonym: 'Finnish' },
  { name: 'Turkiye', demonym: 'Turkish' },
  // South America
  { name: 'Brazil', demonym: 'Brazilian' },
  { name: 'Argentina', demonym: 'Argentine' },
  { name: 'Uruguay', demonym: 'Uruguayan' },
  { name: 'Colombia', demonym: 'Colombian' },
  { name: 'Chile', demonym: 'Chilean' },
  { name: 'Ecuador', demonym: 'Ecuadorian' },
  // North America / Caribbean (CONCACAF)
  { name: 'United States', demonym: 'American' },
  { name: 'Mexico', demonym: 'Mexican' },
  { name: 'Canada', demonym: 'Canadian' },
  { name: 'Jamaica', demonym: 'Jamaican' },
  { name: 'Trinidad & Tobago', demonym: 'Trinidadian' },
  // Africa
  { name: 'Nigeria', demonym: 'Nigerian' },
  { name: 'Senegal', demonym: 'Senegalese' },
  { name: 'Ivory Coast', demonym: 'Ivorian', apiName: 'Cote D’Ivoire' },
  { name: 'Ghana', demonym: 'Ghanaian' },
  { name: 'Egypt', demonym: 'Egyptian' },
  { name: 'Cameroon', demonym: 'Cameroonian' },
  { name: 'Algeria', demonym: 'Algerian' },
  { name: 'Morocco', demonym: 'Moroccan' },
  { name: 'South Africa', demonym: 'South African' },
  { name: 'DR Congo', demonym: 'Congolese' },
  { name: 'Mali', demonym: 'Malian' },
  // Asia / Oceania
  { name: 'Australia', demonym: 'Australian' },
  { name: 'South Korea', demonym: 'South Korean' },
  { name: 'Japan', demonym: 'Japanese' },
];

/** Premier League clubs used as club-scope values (canonical + display name).
 *  Start with the ever-present / historically significant clubs; the pipeline
 *  can widen this to every club that has appeared in the PL. */
export const PL_CLUBS: { name: string; short: string }[] = [
  { name: 'Arsenal F.C.', short: 'Arsenal' },
  { name: 'Aston Villa F.C.', short: 'Aston Villa' },
  { name: 'Chelsea F.C.', short: 'Chelsea' },
  { name: 'Everton F.C.', short: 'Everton' },
  { name: 'Liverpool F.C.', short: 'Liverpool' },
  { name: 'Manchester City F.C.', short: 'Manchester City' },
  { name: 'Manchester United F.C.', short: 'Manchester United' },
  { name: 'Newcastle United F.C.', short: 'Newcastle United' },
  { name: 'Tottenham Hotspur F.C.', short: 'Tottenham Hotspur' },
  { name: 'West Ham United F.C.', short: 'West Ham United' },
];

// ---------------------------------------------------------------------------
// LIST question template
// ---------------------------------------------------------------------------

export interface ListQuestionTemplate {
  competition: Competition;
  metric: Metric;
  scopeType: ScopeType;
  scopeValue: string; // '' for overall; country name or club short name otherwise
  // NOTE: the list size (topN) is chosen dynamically per scope by the pipeline
  // (tiered 10→5→3 based on how many players clear METRIC_FLOOR), not fixed here.
}

/** Render the human-facing prompt for a LIST template at a chosen size.
 *  e.g. "Name the top 5 goalscorers in Premier League history."
 *       "Name the top 5 English goalscorers in Premier League history."
 *       "Name the top 10 appearance makers for Arsenal in the Premier League." */
export function renderListPrompt(t: ListQuestionTemplate, topN: number): string {
  const comp = COMPETITION_LABELS[t.competition];
  const noun = METRIC_LABELS[t.metric].noun;
  if (t.scopeType === 'overall') {
    return `Name the top ${topN} ${noun} in ${comp} history.`;
  }
  if (t.scopeType === 'country') {
    const c = COUNTRIES.find((x) => x.name === t.scopeValue);
    const demonym = c ? c.demonym : t.scopeValue;
    return `Name the top ${topN} ${demonym} ${noun} in ${comp} history.`;
  }
  return `Name the top ${topN} ${noun} for ${t.scopeValue} in the ${comp}.`;
}

// ---------------------------------------------------------------------------
// CAREER-PATH question template
// ---------------------------------------------------------------------------

/** Career-path questions don't need per-question authoring: the pipeline builds
 *  a pool of "notable" players (the union of the top-K in each metric, which
 *  naturally spans strikers, playmakers, defenders and goalkeepers) and emits
 *  one career-path question per player using their Wikipedia infobox. */
export interface CareerPoolSpec {
  competition: Competition;
  /** How many players to take from the top of each metric ranking into the pool. */
  topKPerMetric: number;
  metrics: Metric[];
}

export const DEFAULT_CAREER_POOL: CareerPoolSpec = {
  competition: 'PREMIER_LEAGUE',
  topKPerMetric: 25,
  metrics: ['goals', 'assists', 'appearances', 'cleanSheets'],
};

// ---------------------------------------------------------------------------
// Template expansion — the cross-product the pipeline will try to generate.
// A generated question is only KEPT if the answer bank actually yields enough
// answers for it (e.g. a country with fewer than topN qualifying players is
// skipped or emitted at a smaller N). That filtering happens in build-questions.ts.
// ---------------------------------------------------------------------------

/** Metrics available from the Premier League API (all four are supported). */
export const SUPPORTED_METRICS: Metric[] = ['goals', 'assists', 'appearances', 'cleanSheets'];

/** One LIST template per (metric × scope). The pipeline then picks the list
 *  size dynamically (tiered 10→5→3) from how many players clear METRIC_FLOOR,
 *  and drops the scope entirely if fewer than 3 qualify.
 *
 *  `clubs` is the list of club names to scope by — pass the full set fetched
 *  from the PL API (all 51 clubs). Falls back to the PL_CLUBS shortlist. */
export function expandListTemplates(
  clubs: string[] = PL_CLUBS.map((c) => c.short),
  competition: Competition = 'PREMIER_LEAGUE',
): ListQuestionTemplate[] {
  const out: ListQuestionTemplate[] = [];
  for (const metric of SUPPORTED_METRICS) {
    out.push({ competition, metric, scopeType: 'overall', scopeValue: '' });
    for (const country of COUNTRIES) {
      out.push({ competition, metric, scopeType: 'country', scopeValue: country.name });
    }
    for (const club of clubs) {
      out.push({ competition, metric, scopeType: 'club', scopeValue: club });
    }
  }
  return out;
}
