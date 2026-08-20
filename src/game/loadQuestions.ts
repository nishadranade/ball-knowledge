import type { Format, Question, QuestionBundle } from './types';
import type { DailySchedule } from './daily';

/**
 * The answer bank is split one file per format (see scripts/bank.ts) so a
 * visitor downloads only what their current view needs. The combined bank is
 * 5.2 MB; a frozen daily needs none of it, because daily.json carries its
 * questions as full objects.
 */
const BANK_FILES: Record<Format, string> = {
  LIST: 'q-list.json',
  CAREER_PATH: 'q-career.json',
  MATCH: 'q-match.json',
  SQUAD: 'q-squad.json',
};

/** Every format Practice can serve. */
export const ALL_FORMATS: Format[] = ['LIST', 'CAREER_PATH', 'MATCH', 'SQUAD'];

/** Formats `selectDaily` actually draws from — currently every format, so
 *  this equals ALL_FORMATS. Kept as its own list (rather than reusing
 *  ALL_FORMATS directly) so a FUTURE format doesn't silently become fetchable
 *  by an unfrozen daily just because it's practice-selectable; adding one to
 *  the daily has to be a deliberate edit here, in sync with daily.ts. */
export const DAILY_FORMATS: Format[] = ['LIST', 'CAREER_PATH', 'MATCH', 'SQUAD'];

/** In-flight and completed fetches, so a format is never downloaded twice. */
const cache = new Map<Format, Promise<Question[]>>();

/** Fetch (and memoise) one format's questions. */
export function loadFormat(format: Format): Promise<Question[]> {
  let pending = cache.get(format);
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}data/${BANK_FILES[format]}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load ${BANK_FILES[format]}: ${res.status}`);
        return res.json() as Promise<QuestionBundle>;
      })
      .then((bundle) => bundle.questions ?? [])
      .catch((err) => {
        // Don't memoise a failure — a later view should be able to retry.
        cache.delete(format);
        throw err;
      });
    cache.set(format, pending);
  }
  return pending;
}

/** Fetch several formats in parallel and concatenate them. */
export async function loadFormats(formats: Format[]): Promise<Question[]> {
  const parts = await Promise.all(formats.map(loadFormat));
  return parts.flat();
}

/**
 * Which format a `?q=` token belongs to, so a shared link fetches ONE file
 * instead of the whole bank. List and match ids are readable and prefixed;
 * career links are an opaque `c<hash>` token (see `questionParam`), and a
 * literal `career_...` id also lands here.
 */
export function formatForToken(token: string): Format {
  if (token.startsWith('list_')) return 'LIST';
  if (token.startsWith('match_')) return 'MATCH';
  if (token.startsWith('squad_')) return 'SQUAD';
  return 'CAREER_PATH';
}

export interface NeedsInput {
  mode: 'DAILY' | 'PRACTICE';
  /** Practice format filter; 'ALL' means every format. */
  formatFilter: 'ALL' | Format;
  /** The `?q=` token, if the visitor arrived on a deep link. */
  linkedToken: string | null;
  /**
   * Whether today's daily is already frozen in daily.json. A frozen day carries
   * its questions as full objects, so it needs no bank at all. `null` = the
   * schedule hasn't loaded yet, so we don't know and shouldn't fetch anything.
   */
  dayIsFrozen: boolean | null;
}

/**
 * The formats the current view actually requires. Pure so the lazy-loading
 * policy can be unit-tested rather than inferred from network traffic.
 */
export function formatsNeeded({
  mode,
  formatFilter,
  linkedToken,
  dayIsFrozen,
}: NeedsInput): Format[] {
  // A deep link pins the view to one question, whatever the mode.
  if (linkedToken) return [formatForToken(linkedToken)];
  if (mode === 'DAILY') {
    // Unknown yet → fetch nothing; frozen → nothing needed; otherwise the live
    // selection has to hash the pool of formats it actually draws from.
    if (dayIsFrozen === null || dayIsFrozen) return [];
    return DAILY_FORMATS;
  }
  return formatFilter === 'ALL' ? ALL_FORMATS : [formatFilter];
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

/** Test seam: forget everything fetched so far. */
export function __resetBankCache(): void {
  cache.clear();
}
