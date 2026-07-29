/**
 * Freeze the daily schedule (public/data/daily.json).
 *
 * For every day from the launch epoch through TODAY (US Pacific), record the
 * exact daily questions as FULL objects. Existing entries are NEVER rewritten —
 * we only append days not already frozen. Because the same build that changes
 * questions.json also runs this and preserves past days, no deploy can ever
 * change a past-or-today daily. Future days stay hash-derived (unseen, so it
 * doesn't matter) until a later build freezes them.
 *
 * Run automatically by `build:data`; also runnable standalone via `build:daily`.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { selectDaily, dateKey, type DailySchedule } from '../src/game/daily.js';
import type { Question, QuestionBundle } from '../src/game/types.js';

const OUT_DIR = 'public/data';
const QUESTIONS_PATH = path.join(OUT_DIR, 'questions.json');
const SCHEDULE_PATH = path.join(OUT_DIR, 'daily.json');
const EPOCH_KEY = '2026-07-28'; // must match daily.ts EPOCH_KEY

/** Every "YYYY-MM-DD" from `from` through `to` inclusive (UTC-safe). */
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function readSchedule(): Promise<DailySchedule> {
  try {
    return JSON.parse(await fs.readFile(SCHEDULE_PATH, 'utf8')) as DailySchedule;
  } catch {
    return {}; // no schedule yet
  }
}

async function main() {
  const bundle = JSON.parse(await fs.readFile(QUESTIONS_PATH, 'utf8')) as QuestionBundle;
  const questions: Question[] = bundle.questions;

  const schedule = await readSchedule();
  const today = dateKey();
  let added = 0;
  for (const key of dateRange(EPOCH_KEY, today)) {
    if (schedule[key]) continue; // never overwrite a frozen day
    schedule[key] = selectDaily(questions, key);
    added++;
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(SCHEDULE_PATH, JSON.stringify(schedule, null, 2));
  const total = Object.keys(schedule).length;
  console.log(`daily.json: +${added} new day(s), ${total} total (through ${today}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
