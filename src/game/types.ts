/**
 * Shared data contract between the data-prep pipeline (scripts/) and the game UI (src/).
 * The pipeline emits JSON matching these types; the app consumes it. Keep in sync.
 */

export type Category = 'PREMIER_LEAGUE' | 'CHAMPIONS_LEAGUE' | 'WORLD_CUP';
export type Format = 'LIST' | 'CAREER_PATH' | 'MATCH';
/** Career-path difficulty: STANDARD = famous players, HARD = rarer ones. */
export type Difficulty = 'STANDARD' | 'HARD';

export interface Player {
  /** Full display name, e.g. "Alan Shearer". */
  fullName: string;
  /** Surname used as the primary acceptable answer, e.g. "Shearer". */
  lastName: string;
  /** Alternate accepted spellings / nicknames, normalized loosely. */
  aliases?: string[];
}

export interface ListAnswer extends Player {
  /** The ranking metric value (goals / apps / clean sheets), shown on reveal. */
  value?: number;
  rank?: number;
}

export interface CareerStint {
  years: string; // "1999–2007"
  club: string; // display name, e.g. "Arsenal"
  appearances?: number;
  goals?: number;
  loan?: boolean;
}

export interface SourceRef {
  name: string; // e.g. "Wikipedia"
  url: string;
  retrievedAt: string; // ISO date
}

export interface BaseQuestion {
  id: string;
  category: Category;
  format: Format;
  prompt: string;
  /** Allowed wrong guesses before the round ends. 3 for LIST and MATCH, 2 for
   *  CAREER_PATH. */
  maxWrong: number;
  source: SourceRef;
  /**
   * Rarity band. STANDARD = approachable (famous players; major clubs/countries
   * at full top-10). HARD = tougher (rare players; lesser clubs/countries, capped
   * smaller). Applies to BOTH formats; Standard mode + the daily use STANDARD only.
   */
  difficulty: Difficulty;
}

export interface ListQuestion extends BaseQuestion {
  format: 'LIST';
  /** The correct answers, already sorted by rank (length ≥ requested N; more if tied). */
  answers: ListAnswer[];
}

export interface CareerPathQuestion extends BaseQuestion {
  format: 'CAREER_PATH';
  /** Senior-career club stints shown to the player (name hidden). */
  career: CareerStint[];
  answer: Player;
  /** Player's best (lowest) rank across all metrics/competitions — a fame proxy.
   *  Lower = more famous. Used to keep the daily's career pick well-known. */
  bestRank?: number;
}

/** The fixture a MATCH question is about. All of it is shown to the player —
 *  including the score, which frames the question rather than being part of it.
 *  The answer is purely "who scored". */
export interface MatchInfo {
  homeTeam: string;
  awayTeam: string;
  /** Full-time score, shown in the fixture header. */
  homeScore: number;
  awayScore: number;
  /** ISO date "YYYY-MM-DD" — used for ordering and difficulty banding. */
  date: string;
  /** Display date, e.g. "12 January 2019". */
  dateLabel: string;
  /** Knockout round label for CL ties, e.g. "Round of 16". Absent for league games. */
  round?: string;
}

export interface MatchScorer extends Player {
  /** Goals this player scored IN THIS MATCH — 2 for a brace. Shown on reveal. */
  goals: number;
  /** Which side they scored for. Shown on reveal, never before. */
  team: string;
}

export interface MatchQuestion extends BaseQuestion {
  format: 'MATCH';
  match: MatchInfo;
  /**
   * The DISTINCT scorers, one slot each (a brace is one slot with goals: 2),
   * ordered by first goal. Own goals are excluded — the scorer plays for the
   * other side, so they make a nasty answer — which is why the slot count can be
   * lower than the scoreline implies. See `ownGoals`.
   */
  answers: MatchScorer[];
  /** Own goals in this match, so the reveal can explain the missing goals. */
  ownGoals?: number;
}

export type Question = ListQuestion | CareerPathQuestion | MatchQuestion;

export interface QuestionBundle {
  generatedAt: string;
  questions: Question[];
}
