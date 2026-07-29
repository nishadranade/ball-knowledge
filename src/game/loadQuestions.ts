import type { QuestionBundle } from './types';
import type { DailySchedule } from './daily';

/** Fetch the static question bundle shipped under public/data/. */
export async function loadQuestions(): Promise<QuestionBundle> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/questions.json`);
  if (!res.ok) throw new Error(`Failed to load questions.json: ${res.status}`);
  return (await res.json()) as QuestionBundle;
}

/** Fetch the frozen daily schedule. Returns null if it isn't present (dev, or
 *  before the first build:daily) — callers then fall back to live selection. */
export async function loadDailySchedule(): Promise<DailySchedule | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/daily.json`);
    if (!res.ok) return null;
    return (await res.json()) as DailySchedule;
  } catch {
    return null;
  }
}
