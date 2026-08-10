/**
 * The answer bank on disk, split one file per question format.
 *
 * It used to be a single public/data/questions.json. That file reached 5.2 MB,
 * and the browser downloaded ALL of it before the game could start — including
 * the ~3 MB of match questions a player never sees if they only play the daily.
 * Splitting by format lets the app fetch just what a view needs (see
 * src/game/loadQuestions.ts).
 *
 * These files are the single source of truth: there is no combined file to drift
 * out of sync with them. Every build script reads and writes through here.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Format, Question, QuestionBundle } from '../src/game/types.js';

export const BANK_DIR = 'public/data';

/** One file per format. Names are also used by the browser loader — keep in sync. */
export const BANK_FILES: Record<Format, string> = {
  LIST: 'q-list.json',
  CAREER_PATH: 'q-career.json',
  MATCH: 'q-match.json',
};

export const BANK_FORMATS = Object.keys(BANK_FILES) as Format[];

export function bankPath(format: Format): string {
  return path.join(BANK_DIR, BANK_FILES[format]);
}

/** Questions for one format. Missing file → empty, so a partial bank still builds. */
export async function readBankFile(format: Format): Promise<Question[]> {
  try {
    const raw = await fs.readFile(bankPath(format), 'utf8');
    return (JSON.parse(raw) as QuestionBundle).questions ?? [];
  } catch {
    return [];
  }
}

/** The whole bank, every format concatenated. */
export async function readBank(): Promise<Question[]> {
  const parts = await Promise.all(BANK_FORMATS.map(readBankFile));
  return parts.flat();
}

/** Write one format's file, asserting its contents actually belong there. */
export async function writeBankFile(
  format: Format,
  questions: Question[],
  generatedAt: string,
): Promise<void> {
  const wrong = questions.find((q) => q.format !== format);
  if (wrong) {
    throw new Error(`writeBankFile(${format}) got a ${wrong.format} question: ${wrong.id}`);
  }
  await fs.mkdir(BANK_DIR, { recursive: true });
  await fs.writeFile(bankPath(format), JSON.stringify({ generatedAt, questions }, null, 2));
}

/** Byte size of each bank file, for build logging. */
export async function bankSizes(): Promise<{ format: Format; bytes: number }[]> {
  return Promise.all(
    BANK_FORMATS.map(async (format) => {
      try {
        return { format, bytes: (await fs.stat(bankPath(format))).size };
      } catch {
        return { format, bytes: 0 };
      }
    }),
  );
}
