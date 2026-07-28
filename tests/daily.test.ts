import { describe, it, expect } from 'vitest';
import {
  dateKey,
  dayNumber,
  hashString,
  selectDaily,
  truncateDailyList,
  buildShareText,
  type DailyResult,
} from '../src/game/daily';
import type { Question, ListQuestion } from '../src/game/types';

const list = (id: string, difficulty: 'STANDARD' | 'HARD' = 'STANDARD'): Question => ({
  id,
  category: 'PREMIER_LEAGUE',
  format: 'LIST',
  prompt: 'p',
  maxWrong: 3,
  difficulty,
  source: { name: 'x', url: 'x', retrievedAt: 'x' },
  answers: [{ fullName: 'A B', lastName: 'B' }],
});
const career = (id: string, difficulty: 'STANDARD' | 'HARD' = 'STANDARD'): Question => ({
  id,
  category: 'PREMIER_LEAGUE',
  format: 'CAREER_PATH',
  prompt: 'p',
  maxWrong: 2,
  difficulty,
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
  it('day number increments by Pacific day (epoch 2026-07-28 = #1)', () => {
    // Local noon in Pacific on the epoch date → day 1.
    expect(dayNumber(new Date('2026-07-28T19:00:00Z'))).toBe(1); // 12:00 PDT Jul 28
    expect(dayNumber(new Date('2026-08-07T19:00:00Z'))).toBe(11);
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
  it('only picks STANDARD questions', () => {
    // A pool where the hash-preferred entries would be HARD if not filtered.
    const mixed: Question[] = [
      list('l-hard', 'HARD'),
      list('l-std', 'STANDARD'),
      career('c-hard', 'HARD'),
      career('c-std', 'STANDARD'),
    ];
    for (const key of ['2026-03-05', '2026-06-10', '2026-09-22', '2027-01-01']) {
      const d = selectDaily(mixed, key);
      expect(d.list?.id).toBe('l-std');
      expect(d.career?.id).toBe('c-std');
    }
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

  it('has blank lines separating header, rows, and url', () => {
    const result: DailyResult = {
      day: 7,
      results: [
        { format: 'LIST', found: 5, total: 5, wrong: 0, maxWrong: 3, won: true },
        { format: 'CAREER_PATH', found: 0, total: 1, wrong: 2, maxWrong: 2, won: false },
      ],
    };
    const lines = buildShareText(result).split('\n');
    expect(lines[0]).toContain('Ball Knowledge #7'); // header
    expect(lines[1]).toBe(''); // blank after header
    expect(lines[lines.length - 2]).toBe(''); // blank before url
    expect(lines[lines.length - 1]).toContain('ball-knowledge'); // url last
  });
});

describe('truncateDailyList', () => {
  const bigList: ListQuestion = {
    id: 'x',
    category: 'PREMIER_LEAGUE',
    format: 'LIST',
    prompt: 'Name the top 10 goalscorers in Premier League history.',
    maxWrong: 3,
    difficulty: 'STANDARD',
    source: { name: 'x', url: 'x', retrievedAt: 'x' },
    answers: Array.from({ length: 10 }, (_, i) => ({
      fullName: `P${i}`,
      lastName: `P${i}`,
      value: 100 - i,
    })),
  };

  it('cuts a top-10 down to top 5 and rewrites the prompt', () => {
    const t = truncateDailyList(bigList);
    expect(t.answers.length).toBe(5);
    expect(t.prompt).toContain('top 5');
    expect(t.prompt).not.toContain('top 10');
  });

  it('leaves a top-5 (or smaller) list untouched', () => {
    const small: ListQuestion = { ...bigList, answers: bigList.answers.slice(0, 5) };
    expect(truncateDailyList(small)).toBe(small);
  });
});
