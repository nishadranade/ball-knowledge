import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadFormat,
  loadFormats,
  formatsNeeded,
  __resetBankCache,
} from '../src/game/loadQuestions';

/**
 * What actually goes over the wire. `formatsNeeded` decides the policy; this
 * asserts the fetches that follow from it, so "the daily doesn't download 5MB"
 * is verified rather than assumed.
 */

let requested: string[] = [];

beforeEach(() => {
  __resetBankCache();
  requested = [];
  vi.stubGlobal('fetch', (url: string) => {
    requested.push(String(url));
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ generatedAt: '', questions: [{ id: `from:${url}` }] }),
    } as unknown as Response);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Run the real app decision, then the real fetches that follow from it. */
const fetchFor = async (input: Parameters<typeof formatsNeeded>[0]) => {
  const needed = formatsNeeded(input);
  if (needed.length) await loadFormats(needed);
  return requested.map((u) => u.replace(/^.*\/data\//, ''));
};

const base = { mode: 'DAILY', formatFilter: 'ALL', linkedToken: null, dayIsFrozen: null } as const;

describe('what the browser actually downloads', () => {
  it('a frozen daily fetches NO bank files at all', async () => {
    expect(await fetchFor({ ...base, dayIsFrozen: true })).toEqual([]);
  });

  it('the daily fetches nothing while the schedule is still in flight', async () => {
    expect(await fetchFor({ ...base, dayIsFrozen: null })).toEqual([]);
  });

  it('an unfrozen daily falls back to the full bank', async () => {
    expect((await fetchFor({ ...base, dayIsFrozen: false })).sort()).toEqual([
      'q-career.json',
      'q-list.json',
      'q-match.json',
      'q-squad.json',
    ]);
  });

  it('practice with a format filter fetches exactly one file', async () => {
    expect(
      await fetchFor({ ...base, mode: 'PRACTICE', formatFilter: 'MATCH', dayIsFrozen: true }),
    ).toEqual(['q-match.json']);
  });

  it('practice with the squad filter fetches exactly the squad file', async () => {
    expect(
      await fetchFor({ ...base, mode: 'PRACTICE', formatFilter: 'SQUAD', dayIsFrozen: true }),
    ).toEqual(['q-squad.json']);
  });

  it('practice with ALL fetches every format, including squad', async () => {
    expect(
      (await fetchFor({ ...base, mode: 'PRACTICE', formatFilter: 'ALL', dayIsFrozen: true })).sort(),
    ).toEqual(['q-career.json', 'q-list.json', 'q-match.json', 'q-squad.json']);
  });

  it('a shared career link fetches only the career file', async () => {
    expect(
      await fetchFor({ ...base, mode: 'PRACTICE', linkedToken: 'c1a2b3', dayIsFrozen: true }),
    ).toEqual(['q-career.json']);
  });

  it('a shared match link fetches only the match file', async () => {
    expect(
      await fetchFor({
        ...base,
        mode: 'PRACTICE',
        linkedToken: 'match_premier_league_2019-01-12_a_b',
        dayIsFrozen: true,
      }),
    ).toEqual(['q-match.json']);
  });

  it('a shared squad link fetches only the squad file', async () => {
    expect(
      await fetchFor({
        ...base,
        mode: 'PRACTICE',
        linkedToken: 'squad_premier_league_2019-01-12_a_b_home',
        dayIsFrozen: true,
      }),
    ).toEqual(['q-squad.json']);
  });
});

describe('bank cache', () => {
  it('never downloads the same format twice', async () => {
    await loadFormat('LIST');
    await loadFormat('LIST');
    await loadFormats(['LIST', 'MATCH']);
    expect(requested.filter((u) => u.endsWith('q-list.json'))).toHaveLength(1);
    expect(requested.filter((u) => u.endsWith('q-match.json'))).toHaveLength(1);
  });

  it('deduplicates concurrent requests for the same format', async () => {
    await Promise.all([loadFormat('CAREER_PATH'), loadFormat('CAREER_PATH')]);
    expect(requested).toHaveLength(1);
  });

  it('does not cache a failure, so a later view can retry', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 404 } as Response));
    await expect(loadFormat('LIST')).rejects.toThrow(/404/);

    // Recovered endpoint: the retry must actually go out again.
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ generatedAt: '', questions: [] }),
      } as unknown as Response);
    });
    await expect(loadFormat('LIST')).resolves.toEqual([]);
    expect(calls).toBe(1);
  });

  it('tolerates a bundle with no questions array', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response),
    );
    await expect(loadFormat('MATCH')).resolves.toEqual([]);
  });
});
