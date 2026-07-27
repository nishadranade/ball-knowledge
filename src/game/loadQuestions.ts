import type { QuestionBundle } from './types';

/** Fetch the static question bundle shipped under public/data/. */
export async function loadQuestions(): Promise<QuestionBundle> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/questions.json`);
  if (!res.ok) throw new Error(`Failed to load questions.json: ${res.status}`);
  return (await res.json()) as QuestionBundle;
}
