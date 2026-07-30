import { describe, it, expect } from 'vitest';
import {
  dateKey,
  dayNumber,
  hashString,
  selectDaily,
  resolveDaily,
  truncateDailyList,
  buildShareText,
  buildPracticeShareText,
  buildQuestionLink,
  formatDuration,
  type DailyResult,
  type DailySchedule,
  type RoundResult,
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

describe('formatDuration', () => {
  it('formats ms as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9_000)).toBe('0:09');
    expect(formatDuration(67_000)).toBe('1:07');
    expect(formatDuration(600_000)).toBe('10:00');
  });
  it('rounds to the nearest second and clamps negatives', () => {
    expect(formatDuration(1_400)).toBe('0:01');
    expect(formatDuration(1_600)).toBe('0:02');
    expect(formatDuration(-50)).toBe('0:00');
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

describe('resolveDaily (frozen schedule)', () => {
  it('returns the frozen entry when present, ignoring the live pool', () => {
    const frozenList = list('frozen-list') as ListQuestion;
    const schedule: DailySchedule = {
      '2026-03-05': { list: frozenList, career: null },
    };
    // Pass a totally different pool; the frozen entry must win.
    const d = resolveDaily(pool, schedule, '2026-03-05');
    expect(d.list?.id).toBe('frozen-list');
    expect(d.career).toBeNull();
  });

  it('falls back to live selection when the date is not frozen', () => {
    const schedule: DailySchedule = { '2026-03-05': { list: null, career: null } };
    const d = resolveDaily(pool, schedule, '2026-03-06'); // different date
    expect(d.list?.id).toBe(selectDaily(pool, '2026-03-06').list?.id);
  });

  it('falls back to live selection when there is no schedule', () => {
    const d = resolveDaily(pool, null, '2026-03-06');
    expect(d.list?.id).toBe(selectDaily(pool, '2026-03-06').list?.id);
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
    expect(text).toContain('4/5');
    expect(text).toContain('(1 guess)');
    // no player names leaked (share text is only emojis, stats, and the title)
    expect(text).not.toContain('Shearer');
    expect(text).not.toContain('Beckham');
  });

  it('LIST grid follows slot (rank) order, not just counts', () => {
    const result: DailyResult = {
      day: 1,
      results: [
        // found ranks 1, 3, 5 (missed 2 and 4) → 🟩🟥🟩🟥🟩
        {
          format: 'LIST',
          found: 3,
          total: 5,
          wrong: 3,
          maxWrong: 3,
          won: false,
          slots: [true, false, true, false, true],
        },
      ],
    };
    expect(buildShareText(result)).toContain('🟩🟥🟩🟥🟩 (3/5)');
  });

  it('career grid shows a red square per wrong guess before the green', () => {
    const mk = (wrong: number, won: boolean): DailyResult => ({
      day: 1,
      results: [{ format: 'CAREER_PATH', found: won ? 1 : 0, total: 1, wrong, maxWrong: 2, won }],
    });
    expect(buildShareText(mk(0, true))).toContain('👤 Career: 🟩 (1 guess)'); // first try
    expect(buildShareText(mk(1, true))).toContain('👤 Career: 🟥🟩 (2 guesses)'); // second try
    expect(buildShareText(mk(2, false))).toContain('👤 Career: 🟥🟥 (missed)'); // both wrong
  });

  it('includes per-question time when elapsedMs is present', () => {
    const result: DailyResult = {
      day: 5,
      results: [
        { format: 'LIST', found: 5, total: 5, wrong: 0, maxWrong: 3, won: true, elapsedMs: 67_000 },
        { format: 'CAREER_PATH', found: 1, total: 1, wrong: 1, maxWrong: 2, won: true, elapsedMs: 24_000 },
      ],
    };
    const text = buildShareText(result);
    expect(text).toContain('(5/5 · 1:07)');
    expect(text).toContain('(2 guesses · 0:24)');
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

describe('buildQuestionLink', () => {
  it('builds an absolute ?q= deep link from origin + base', () => {
    expect(buildQuestionLink('list_pl_goals_overall_all_10', 'https://x.github.io', '/ball-knowledge/')).toBe(
      'https://x.github.io/ball-knowledge/?q=list_pl_goals_overall_all_10',
    );
  });
  it('url-encodes the id', () => {
    expect(buildQuestionLink('a b&c', 'https://x', '/')).toBe('https://x/?q=a%20b%26c');
  });
});

describe('buildPracticeShareText', () => {
  const result: RoundResult = {
    format: 'LIST',
    found: 3,
    total: 5,
    wrong: 3,
    maxWrong: 3,
    won: false,
    slots: [true, false, true, false, true],
    elapsedMs: 45_000,
  };
  const link = 'https://x.github.io/ball-knowledge/?q=abc';
  const prompt = 'Name the top 5 German goalscorers in Premier League history.';

  it('includes the prompt, result row (with time) and the deep link — no player names', () => {
    const text = buildPracticeShareText(result, prompt, link);
    expect(text).toContain('Ball Knowledge');
    expect(text).toContain(prompt); // prompt names the challenge, not answers
    expect(text).toContain('🟩🟥🟩🟥🟩 (3/5 · 0:45)');
    expect(text).toContain(link);
    expect(text).not.toContain('Gündogan'); // no answers leaked
  });
});
