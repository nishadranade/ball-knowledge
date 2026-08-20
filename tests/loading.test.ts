import { describe, it, expect } from 'vitest';
import { formatsNeeded, formatForToken, ALL_FORMATS, DAILY_FORMATS } from '../src/game/loadQuestions';
import { questionParam } from '../src/game/daily';
import type { Question } from '../src/game/types';

/**
 * The lazy-loading policy. This is the whole point of splitting the bank: the
 * combined files are ~5MB, and a visitor should download only what their view
 * needs. Testing the decision directly beats trying to infer it from network
 * traffic — a regression here silently reintroduces the full download.
 */

const base = { mode: 'DAILY', formatFilter: 'ALL', linkedToken: null, dayIsFrozen: null } as const;

describe('formatsNeeded — daily', () => {
  it('fetches NOTHING while the schedule is still loading', () => {
    // Guessing here would defeat the point: we'd fetch 5MB and then find out
    // the day was frozen and needed none of it.
    expect(formatsNeeded({ ...base, dayIsFrozen: null })).toEqual([]);
  });

  it('fetches NOTHING for a frozen day — daily.json already has the questions', () => {
    expect(formatsNeeded({ ...base, dayIsFrozen: true })).toEqual([]);
  });

  it('fetches every format the daily actually draws from for an unfrozen day', () => {
    expect(formatsNeeded({ ...base, dayIsFrozen: false })).toEqual(DAILY_FORMATS);
  });

  it('ignores the practice format filter while in daily mode', () => {
    expect(formatsNeeded({ ...base, formatFilter: 'LIST', dayIsFrozen: true })).toEqual([]);
    expect(formatsNeeded({ ...base, formatFilter: 'LIST', dayIsFrozen: false })).toEqual(
      DAILY_FORMATS,
    );
  });

  it('never fetches SQUAD for the daily — selectDaily does not draw one', () => {
    // SQUAD is practice-only. If it ever joins the daily, DAILY_FORMATS must be
    // updated deliberately — this pins the current, narrower behavior.
    expect(DAILY_FORMATS).not.toContain('SQUAD');
    expect(ALL_FORMATS).toContain('SQUAD'); // but it IS a real practice format
  });
});

describe('formatsNeeded — practice', () => {
  const practice = { ...base, mode: 'PRACTICE' } as const;

  it('fetches only the filtered format', () => {
    expect(formatsNeeded({ ...practice, formatFilter: 'LIST' })).toEqual(['LIST']);
    expect(formatsNeeded({ ...practice, formatFilter: 'CAREER_PATH' })).toEqual(['CAREER_PATH']);
    expect(formatsNeeded({ ...practice, formatFilter: 'MATCH' })).toEqual(['MATCH']);
    expect(formatsNeeded({ ...practice, formatFilter: 'SQUAD' })).toEqual(['SQUAD']);
  });

  it('fetches everything only when the filter is ALL', () => {
    expect(formatsNeeded({ ...practice, formatFilter: 'ALL' })).toEqual(ALL_FORMATS);
  });

  it('does not depend on the daily schedule', () => {
    for (const dayIsFrozen of [null, true, false] as const) {
      expect(formatsNeeded({ ...practice, formatFilter: 'MATCH', dayIsFrozen })).toEqual(['MATCH']);
    }
  });
});

describe('formatsNeeded — deep links', () => {
  it('fetches exactly one format, whatever the mode or filter', () => {
    for (const mode of ['DAILY', 'PRACTICE'] as const) {
      expect(formatsNeeded({ ...base, mode, linkedToken: 'list_pl_goals_overall_all_10' })).toEqual(
        ['LIST'],
      );
      expect(
        formatsNeeded({ ...base, mode, linkedToken: 'match_premier_league_2019-01-12_a_b' }),
      ).toEqual(['MATCH']);
      expect(
        formatsNeeded({ ...base, mode, linkedToken: 'squad_premier_league_2019-01-12_a_b_home' }),
      ).toEqual(['SQUAD']);
      expect(formatsNeeded({ ...base, mode, linkedToken: 'c1a2b3' })).toEqual(['CAREER_PATH']);
    }
  });
});

describe('formatForToken', () => {
  const q = (id: string, format: Question['format']): Question =>
    ({ id, format }) as unknown as Question;

  it('maps each id prefix to its file', () => {
    expect(formatForToken('list_premier_league_goals_overall_all_10')).toBe('LIST');
    expect(formatForToken('match_premier_league_2019-01-12_liverpool_arsenal')).toBe('MATCH');
    expect(formatForToken('squad_premier_league_2019-01-12_liverpool_arsenal_home')).toBe('SQUAD');
    expect(formatForToken('career_alan_shearer')).toBe('CAREER_PATH');
  });

  it('maps the opaque career token to the career file', () => {
    // Career links are hashed (the id would spell the answer), so the token
    // carries no prefix — anything unrecognised must resolve to career.
    const token = questionParam(q('career_alan_shearer', 'CAREER_PATH'));
    expect(token).toMatch(/^c[0-9a-z]+$/);
    expect(formatForToken(token)).toBe('CAREER_PATH');
  });

  it('agrees with questionParam for every readable format', () => {
    // If questionParam ever stops emitting readable ids for these, a shared link
    // would fetch the wrong file and 404 the question.
    expect(formatForToken(questionParam(q('list_x_y_z', 'LIST')))).toBe('LIST');
    expect(formatForToken(questionParam(q('match_x_y_z', 'MATCH')))).toBe('MATCH');
    expect(formatForToken(questionParam(q('squad_x_y_z', 'SQUAD')))).toBe('SQUAD');
  });

  it('falls back to career for an unrecognised token rather than throwing', () => {
    expect(formatForToken('nonsense')).toBe('CAREER_PATH');
    expect(formatForToken('')).toBe('CAREER_PATH');
  });
});
