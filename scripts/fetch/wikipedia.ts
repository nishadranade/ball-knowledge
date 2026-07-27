/**
 * Wikipedia fetch + wikitext parsing for CAREER-PATH questions.
 *
 * LIST questions now come from the Premier League API (see fetch/premierLeague.ts);
 * Wikipedia is used only for player career progression, which the PL API lacks.
 *
 * Key export:
 *  - parseCareerInfobox(): a player's {{Infobox football biography}} → CareerStint[].
 *  - deriveLastName(): surname helper, reused by the PL aggregator.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'SoccerQuizGame/0.1 (educational hobby project; contact: local)';
const CACHE_DIR = 'scripts/.cache';

// ---------------------------------------------------------------------------
// Fetching (with on-disk cache)
// ---------------------------------------------------------------------------

async function cachePath(page: string): Promise<string> {
  const safe = page.replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(CACHE_DIR, `${safe}.wikitext`);
}

/** True if this page's wikitext is already on disk (no network needed). */
export async function hasCached(page: string): Promise<boolean> {
  try {
    await fs.access(await cachePath(page));
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serialize + throttle live requests to respect Wikipedia's rate limits. */
let requestChain: Promise<unknown> = Promise.resolve();
const MIN_GAP_MS = 250;

export async function fetchWikitext(page: string, useCache = true): Promise<string> {
  const cp = await cachePath(page);
  if (useCache) {
    try {
      return await fs.readFile(cp, 'utf8');
    } catch {
      /* cache miss */
    }
  }
  // Queue this fetch behind the previous one, with a gap + retry/backoff on 429.
  const run = requestChain.then(async () => {
    const params = new URLSearchParams({
      action: 'parse',
      page,
      prop: 'wikitext',
      format: 'json',
      formatversion: '2',
      redirects: '1',
    });
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`${WIKI_API}?${params}`, { headers: { 'User-Agent': USER_AGENT } });
      if (res.status === 429) {
        const wait = 1000 * 2 ** attempt;
        await sleep(wait);
        lastErr = new Error(`429 rate limited on ${page}`);
        continue;
      }
      if (!res.ok) throw new Error(`Wikipedia fetch failed for ${page}: ${res.status}`);
      const json: any = await res.json();
      if (json.error) throw new Error(`Wikipedia API error for ${page}: ${json.error.info}`);
      const wt: string = json.parse.wikitext;
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(cp, wt, 'utf8');
      await sleep(MIN_GAP_MS);
      return wt;
    }
    throw lastErr instanceof Error ? lastErr : new Error(`failed to fetch ${page}`);
  });
  // Keep the chain alive even if this link rejects.
  requestChain = run.catch(() => undefined);
  return run as Promise<string>;
}

// ---------------------------------------------------------------------------
// Small wikitext helpers
// ---------------------------------------------------------------------------

/** Strip <ref>...</ref>, {{efn...}}, <!-- --> and stray HTML tags. */
export function stripMarkup(s: string): string {
  return s
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/\{\{efn[^}]*\}\}/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** Resolve a wikilink token to its display text: [[A|B]]→B, [[A]]→A. */
export function linkDisplay(token: string): string {
  const m = token.match(/\[\[([^\]]+)\]\]/);
  if (!m) return stripMarkup(token);
  const inner = m[1];
  const pipe = inner.lastIndexOf('|');
  return (pipe >= 0 ? inner.slice(pipe + 1) : inner).trim();
}

/** Extract a player's display name from a name cell in any of its wikitext forms. */
export function parseNameCell(cell: string): string | null {
  // {{sortname|First|Last|dab=...}} → "First Last"; mononyms like
  // {{sortname||Ederson|...}} (empty first param) → "Ederson".
  const sortname = cell.match(/\{\{sortname\s*\|([^}]*)\}\}/i);
  if (sortname) {
    // {{sortname|First|Last|linkTarget|key=value...}}: only the first TWO
    // positional params are the name; a 3rd positional param is the article
    // link target (e.g. "David James (footballer, born 1970)") — not the name.
    const raw = sortname[1].split('|');
    const positional: string[] = [];
    for (const part of raw) {
      if (part.includes('=')) break; // reached key=value params
      positional.push(part.trim());
    }
    const nameParts = positional.slice(0, 2).filter(Boolean);
    if (nameParts.length) return nameParts.join(' ');
  }

  const link = cell.match(/\[\[([^\]]+)\]\]/);
  if (link) return linkDisplay(link[0]);

  const cleaned = stripMarkup(cell.replace(/''+/g, ''));
  return cleaned || null;
}

/** Lowercase surname particles that should stay attached to the surname
 *  (e.g. "De Bruyne", "van Dijk", "van der Sar"). */
const SURNAME_PARTICLES = new Set([
  'de',
  'del',
  'della',
  'van',
  'von',
  'der',
  'den',
  'ter',
  'te',
  'da',
  'dos',
  'das',
  'di',
  'la',
  'le',
  'el',
  'al',
  'bin',
  'mc',
]);

/** Derive a surname from a full name, keeping leading particles attached
 *  (so "Kevin De Bruyne" → "De Bruyne", "Virgil van Dijk" → "van Dijk"). */
export function deriveLastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] ?? '';
  // Walk backwards, absorbing particle tokens into the surname.
  let i = parts.length - 1;
  while (i > 1 && SURNAME_PARTICLES.has(parts[i - 1].toLowerCase())) i--;
  return parts.slice(i).join(' ');
}

/** Extract nationality from {{flagicon|X}} → "X" (country name or 3-letter code). */
export function parseFlag(cell: string): string | null {
  const m = cell.match(/\{\{[Ff]lagicon\s*\|\s*([^|}]+)/);
  return m ? m[1].trim() : null;
}

export interface ClubSplit {
  club: string;
  count: number;
}

/** Parse "[[Club F.C.|Club]] (112/138)" or "(148)" splits from a Club(s) cell.
 *  For "goals/apps" style, the FIRST number is the metric value (goals). For a
 *  single "(148)" it's that number. */
export function parseClubSplits(cell: string): ClubSplit[] {
  const out: ClubSplit[] = [];
  // Match a wikilink followed (optionally after nowrap/markup) by "(a/b)" or "(a)"
  const re = /\[\[([^\]]+)\]\]\s*\(\s*(\d+)\s*(?:\/\s*\d+\s*)?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cell)) !== null) {
    out.push({ club: linkDisplay(`[[${m[1]}]]`), count: Number(m[2]) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Career infobox parser
// ---------------------------------------------------------------------------

export interface CareerStint {
  years: string;
  club: string;
  appearances?: number;
  goals?: number;
  loan?: boolean;
}

/** Parse the senior-career (years/clubs/caps/goals) rows from a player infobox. */
export function parseCareerInfobox(wikitext: string): CareerStint[] {
  const field = (name: string): string | null => {
    // Value runs until the next field delimiter (" | ") or newline. Infoboxes
    // may put many fields on one line, so we cannot rely on newlines alone.
    // Allow "|" inside [[...]] / {{...}} by stopping only at a pipe that is
    // followed by an identifier and "=" (i.e. the start of the next field).
    const re = new RegExp(`\\|\\s*${name}\\s*=\\s*([\\s\\S]*?)(?=\\n?\\s*\\|\\s*[A-Za-z_][\\w]*\\s*=|\\n\\}\\}|$)`, 'i');
    const m = wikitext.match(re);
    return m ? m[1].trim() : null;
  };
  const stints: CareerStint[] = [];
  for (let i = 1; i <= 30; i++) {
    const years = field(`years${i}`);
    const clubsRaw = field(`clubs${i}`);
    if (!years && !clubsRaw) {
      if (i > 1 && !field(`years${i + 1}`) && !field(`clubs${i + 1}`)) break;
      continue;
    }
    if (!clubsRaw) continue;
    const capsRaw = field(`caps${i}`);
    const goalsRaw = field(`goals${i}`);
    const loan = /\(loan\)|→/.test(clubsRaw);
    const clubName = linkDisplay(clubsRaw.replace(/→/g, '').replace(/\(loan\)/gi, '').trim());
    const capsNum = capsRaw ? stripMarkup(capsRaw).match(/\d+/) : null;
    const goalsNum = goalsRaw ? stripMarkup(goalsRaw).match(/-?\d+/) : null;
    stints.push({
      years: stripMarkup(years ?? '').replace(/&ndash;|–/g, '–'),
      club: clubName,
      appearances: capsNum ? Number(capsNum[0]) : undefined,
      goals: goalsNum ? Number(goalsNum[0]) : undefined,
      loan: loan || undefined,
    });
  }
  return stints;
}
