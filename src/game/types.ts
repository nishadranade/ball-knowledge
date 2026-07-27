/**
 * Shared data contract between the data-prep pipeline (scripts/) and the game UI (src/).
 * The pipeline emits JSON matching these types; the app consumes it. Keep in sync.
 */

export type Category = 'PREMIER_LEAGUE' | 'CHAMPIONS_LEAGUE' | 'WORLD_CUP';
export type Format = 'LIST' | 'CAREER_PATH';
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
  /** Allowed wrong guesses before the round ends. 3 for LIST, 2 for CAREER_PATH. */
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
}

export type Question = ListQuestion | CareerPathQuestion;

export interface QuestionBundle {
  generatedAt: string;
  questions: Question[];
}
