import { describe, it, expect } from 'vitest';
import {
  dateKey,
  dayNumber,
  hashString,
  selectDaily,
  buildShareText,
  type DailyResult,
} from '../src/game/daily';
import type { Question } from '../src/game/types';

const list = (id: string): Question => ({
  id,
  category: 'PREMIER_LEAGUE',
  format: 'LIST',
  prompt: 'p',
  maxWrong: 3,
  source: { name: 'x', url: 'x', retrievedAt: 'x' },
  answers: [{ fullName: 'A B', lastName: 'B' }],
});
const career = (id: string): Question => ({
  id,
  category: 'PREMIER_LEAGUE',
  format: 'CAREER_PATH',
  prompt: 'p',
  maxWrong: 2,
  difficulty: 'STANDARD',
  source: { name: 'x', url: 'x', retrievedAt: 'x' },
  career: [{ years: 'y', club: 'c' }, { years: 'y', club: 'd' }],
  answer: { fullName: 'A B', lastName: 'B' },
});

const pool: Question[] = [
  ...Array.from({ length: 10 }, (_, i) => list(`l${i}`)),
  ...Array.from({ length: 10 }, (_, i) => career(`c${i}`)),
];

describe('dateKey / dayNumber (US Pacific)', () => {
  it('formats a Pacific date key', () => {
    // Noon UTC on Mar 5 is still Mar 5 in Pacific (04:00 PST).
    expect(dateKey(new Date('2026-03-05T12:00:00Z'))).toBe('2026-03-05');
  });
  it('rolls over at Pacific midnight, not UTC', () => {
    // 05:00Z on Mar 5 = 21:00 PST on Mar 4 → still the 4th in Pacific.
    expect(dateKey(new Date('2026-03-05T05:00:00Z'))).toBe('2026-03-04');
    // 09:00Z on Mar 5 = 01:00 PST on Mar 5 → now the 5th.
    expect(dateKey(new Date('2026-03-05T09:00:00Z'))).toBe('2026-03-05');
  });
  it('day number increments by Pacific day', () => {
    // Local noon in Pacific on the epoch date → day 1.
    expect(dayNumber(new Date('2026-01-01T20:00:00Z'))).toBe(1); // 12:00 PST Jan 1
    expect(dayNumber(new Date('2026-01-11T20:00:00Z'))).toBe(11);
  });
});

describe('hashString', () => {
  it('is deterministic and unsigned', () => {
    expect(hashString('2026-03-05:list')).toBe(hashString('2026-03-05:list'));
    expect(hashString('abc')).toBeGreaterThanOrEqual(0);
  });
});

describe('selectDaily', () => {
  it('returns one LIST and one CAREER', () => {
    const d = selectDaily(pool, '2026-03-05');
    expect(d.list?.format).toBe('LIST');
    expect(d.career?.format).toBe('CAREER_PATH');
  });
  it('is stable for the same date key', () => {
    const a = selectDaily(pool, '2026-03-05');
    const b = selectDaily(pool, '2026-03-05');
    expect(a.list?.id).toBe(b.list?.id);
    expect(a.career?.id).toBe(b.career?.id);
  });
  it('differs across dates (at least sometimes)', () => {
    const keys = ['2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08'];
    const ids = new Set(keys.map((k) => selectDaily(pool, k).list?.id));
    expect(ids.size).toBeGreaterThan(1);
  });
  it('handles empty pools gracefully', () => {
    const d = selectDaily([], '2026-03-05');
    expect(d.list).toBeNull();
    expect(d.career).toBeNull();
  });
});

describe('buildShareText', () => {
  it('is spoiler-free and encodes results', () => {
    const result: DailyResult = {
      day: 42,
      results: [
        { format: 'LIST', found: 4, total: 5, wrong: 3, maxWrong: 3, won: false },
        { format: 'CAREER_PATH', found: 1, total: 1, wrong: 0, maxWrong: 2, won: true },
      ],
    };
    const text = buildShareText(result);
    expect(text).toContain('Ball Knowledge #42');
    expect(text).toContain('🟩🟩🟩🟥'); // 4 found, 1 missed
    expect(text).toContain('4/5');
    expect(text).toContain('(1 guess)');
    // no player names leaked (share text is only emojis, stats, and the title)
    expect(text).not.toContain('Shearer');
    expect(text).not.toContain('Beckham');
  });
});
