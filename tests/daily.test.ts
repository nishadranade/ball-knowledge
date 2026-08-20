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
  questionParam,
  resolveQuestionParam,
  formatDuration,
  formatRoundRow,
  computeDailyScore,
  type DailyResult,
  type DailySchedule,
  type RoundResult,
} from '../src/game/daily';
import type {
  Question,
  ListQuestion,
  CareerPathQuestion,
  MatchQuestion,
  SquadQuestion,
} from '../src/game/types';

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

const match = (id: string, difficulty: 'STANDARD' | 'HARD' = 'STANDARD'): Question => ({
  id,
  category: 'PREMIER_LEAGUE',
  format: 'MATCH',
  prompt: 'p',
  maxWrong: 3,
  difficulty,
  source: { name: 'x', url: 'x', retrievedAt: 'x' },
  match: {
    homeTeam: 'H',
    awayTeam: 'A',
    homeScore: 2,
    awayScore: 1,
    date: '2019-01-12',
    dateLabel: '12 January 2019',
  },
  answers: [
    { fullName: 'A B', lastName: 'B', goals: 2, team: 'H' },
    { fullName: 'C D', lastName: 'D', goals: 1, team: 'A' },
  ],
});

const squad = (id: string, difficulty: 'STANDARD' | 'HARD' = 'STANDARD'): Question => ({
  id,
  category: 'PREMIER_LEAGUE',
  format: 'SQUAD',
  prompt: 'Name the starting XI.',
  maxWrong: 6,
  difficulty,
  source: { name: 'x', url: 'x', retrievedAt: 'x' },
  squad: {
    team: 'H',
    opponent: 'A',
    home: true,
    teamScore: 2,
    opponentScore: 1,
    date: '2019-01-12',
    dateLabel: '12 January 2019',
    formation: '4-3-3',
  },
  answers: Array.from({ length: 11 }, (_, i) => ({
    fullName: `P${i} Q${i}`,
    lastName: `Q${i}`,
    shirtNumber: i + 1,
    position: 'D',
  })),
  lines: [[0], [1, 2, 3, 4], [5, 6, 7], [8, 9, 10]],
});

const pool: Question[] = [
  ...Array.from({ length: 10 }, (_, i) => list(`l${i}`)),
  ...Array.from({ length: 10 }, (_, i) => career(`c${i}`)),
  ...Array.from({ length: 10 }, (_, i) => match(`m${i}`)),
  ...Array.from({ length: 10 }, (_, i) => squad(`s${i}`)),
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
  it('returns one LIST and two CAREER questions', () => {
    const d = selectDaily(pool, '2026-03-05');
    expect(d.list?.format).toBe('LIST');
    expect(d.career?.format).toBe('CAREER_PATH');
    expect(d.career2?.format).toBe('CAREER_PATH');
  });
  it('never repeats the same career twice in a day', () => {
    // Every date must draw two DIFFERENT players, not the same one twice.
    for (let i = 1; i <= 60; i++) {
      const d = selectDaily(pool, `2026-03-${String(i % 28 || 28).padStart(2, '0')}`);
      expect(d.career2?.id).not.toBe(d.career?.id);
    }
  });
  it('is stable for the same date key', () => {
    const a = selectDaily(pool, '2026-03-05');
    const b = selectDaily(pool, '2026-03-05');
    expect(a.list?.id).toBe(b.list?.id);
    expect(a.career?.id).toBe(b.career?.id);
    expect(a.career2?.id).toBe(b.career2?.id);
  });
  it('the second career varies across dates', () => {
    const keys = ['2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08'];
    const ids = new Set(keys.map((k) => selectDaily(pool, k).career2?.id));
    expect(ids.size).toBeGreaterThan(1);
  });
  it('includes a MATCH question', () => {
    const d = selectDaily(pool, '2026-03-05');
    expect(d.match?.format).toBe('MATCH');
  });
  it('adding the match slot did not disturb the other draws', () => {
    // The list / career / career2 salts are independent of ':match', so a pool
    // with no match questions must resolve those three exactly as before.
    const noMatches = pool.filter((q) => q.format !== 'MATCH');
    for (const key of ['2026-03-05', '2026-07-04', '2027-01-01']) {
      const full = selectDaily(pool, key);
      const without = selectDaily(noMatches, key);
      expect(full.list?.id).toBe(without.list?.id);
      expect(full.career?.id).toBe(without.career?.id);
      expect(full.career2?.id).toBe(without.career2?.id);
      expect(without.match).toBeNull();
    }
  });
  it('includes a SQUAD question', () => {
    const d = selectDaily(pool, '2026-03-05');
    expect(d.squad?.format).toBe('SQUAD');
  });
  it('adding the squad slot did not disturb the other draws', () => {
    // Same guarantee as the match slot: ':squad' is its own salt, so a pool
    // with no squad questions must resolve every other slot exactly as before.
    const noSquads = pool.filter((q) => q.format !== 'SQUAD');
    for (const key of ['2026-03-05', '2026-07-04', '2027-01-01']) {
      const full = selectDaily(pool, key);
      const without = selectDaily(noSquads, key);
      expect(full.list?.id).toBe(without.list?.id);
      expect(full.career?.id).toBe(without.career?.id);
      expect(full.career2?.id).toBe(without.career2?.id);
      expect(full.match?.id).toBe(without.match?.id);
      expect(without.squad).toBeNull();
    }
  });
  it('leaves career2 null rather than duplicating when only one career exists', () => {
    const thin: Question[] = [list('l0'), career('c0')];
    const d = selectDaily(thin, '2026-03-05');
    expect(d.career?.id).toBe('c0');
    expect(d.career2).toBeNull();
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
    expect(d.career2).toBeNull();
    expect(d.match).toBeNull();
    expect(d.squad).toBeNull();
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

  it('keeps a day frozen before career2 existed as a two-question round', () => {
    // daily.json entries written pre-change have no `career2`. Those days were
    // played as two questions and must stay that way — never back-filled from
    // the live pool, which is the whole point of freezing.
    const schedule: DailySchedule = {
      '2026-03-05': {
        list: list('frozen-list') as ListQuestion,
        career: career('frozen-career') as CareerPathQuestion,
      },
    };
    const d = resolveDaily(pool, schedule, '2026-03-05');
    expect(d.list?.id).toBe('frozen-list');
    expect(d.career?.id).toBe('frozen-career');
    expect(d.career2).toBeNull();
    // Nor may a match or squad be back-filled into a day frozen before those
    // slots existed.
    expect(d.match).toBeNull();
    expect(d.squad).toBeNull();
  });

  it('keeps a frozen match question and never re-draws it', () => {
    const schedule: DailySchedule = {
      '2026-03-05': {
        list: null,
        career: null,
        match: match('frozen-match') as MatchQuestion,
      },
    };
    const d = resolveDaily(pool, schedule, '2026-03-05');
    expect(d.match?.id).toBe('frozen-match');
  });

  it('keeps a frozen squad question and never re-draws it', () => {
    const schedule: DailySchedule = {
      '2026-03-05': {
        list: null,
        career: null,
        squad: squad('frozen-squad') as SquadQuestion,
      },
    };
    const d = resolveDaily(pool, schedule, '2026-03-05');
    expect(d.squad?.id).toBe('frozen-squad');
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

  it('match row is a scorer grid in slot order', () => {
    const result: DailyResult = {
      day: 3,
      results: [
        {
          format: 'MATCH',
          found: 2,
          total: 3,
          wrong: 1,
          maxWrong: 3,
          won: false,
          slots: [true, false, true],
          elapsedMs: 51_000,
        },
      ],
    };
    expect(buildShareText(result)).toContain('⚽ Match: 🟩🟥🟩 (2/3 · 0:51)');
  });

  it('match row leaks neither the fixture, the score, nor any scorer', () => {
    const text = buildShareText({
      day: 3,
      results: [{ format: 'MATCH', found: 3, total: 3, wrong: 0, maxWrong: 3, won: true }],
    });
    expect(text).not.toMatch(/\d+\s*[-–]\s*\d+/); // no scoreline
    expect(text).not.toContain('Salah');
    expect(text).not.toContain('Liverpool');
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

  it('header includes the score, matching computeDailyScore', () => {
    const result: DailyResult = {
      day: 9,
      results: [{ format: 'LIST', found: 5, total: 5, wrong: 0, maxWrong: 3, won: true }],
    };
    const { points, max } = computeDailyScore(result.results);
    const header = buildShareText(result).split('\n')[0];
    expect(header).toBe(`⚽ Ball Knowledge #9 — ${points}/${max} pts`);
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

describe('formatRoundRow (SQUAD)', () => {
  it('renders a shirt-emoji slot grid', () => {
    const r: RoundResult = {
      format: 'SQUAD',
      found: 8,
      total: 11,
      wrong: 5,
      maxWrong: 6,
      won: false,
      slots: [true, true, false, true, true, false, true, true, false, true, true],
      elapsedMs: 134_000,
    };
    expect(formatRoundRow(r)).toBe('👕 Squad: 🟩🟩🟥🟩🟩🟥🟩🟩🟥🟩🟩 (8/11 · 2:14)');
  });
});

describe('computeDailyScore', () => {
  const win = (format: RoundResult['format'], found: number, total: number, wrong = 0): RoundResult => ({
    format,
    found,
    total,
    wrong,
    maxWrong: 3,
    won: found === total,
  });

  it('a perfect, untimed round earns 10/slot plus the perfect bonus', () => {
    const { points, max } = computeDailyScore([win('LIST', 5, 5)]);
    expect(points).toBe(5 * 10 + 10); // 60
    expect(max).toBe(5 * 10 + 10 + 40); // + best-tier speed bonus headroom
  });

  it('a wrong-guess penalty is floored at that round\'s own accuracy points — never negative', () => {
    // 2 slots found (20 accuracy points) but 50 wrong guesses (150-point penalty
    // at 3/wrong) — the floor must clip the penalty to 20, not let it go to -130.
    const disaster = win('LIST', 2, 5, 50);
    const { points } = computeDailyScore([disaster]);
    expect(points).toBe(0); // floored exactly at zero, not negative
  });

  it('no perfect bonus once a wrong guess is logged, even if the round was won', () => {
    const a = computeDailyScore([win('LIST', 5, 5, 0)]).points;
    const b = computeDailyScore([win('LIST', 5, 5, 1)]).points;
    expect(b).toBeLessThan(a);
  });

  it('awards a speed bonus only when every question recorded a time', () => {
    const timed: RoundResult = { ...win('LIST', 5, 5), elapsedMs: 60_000 };
    const untimed: RoundResult = win('CAREER_PATH', 1, 1); // no elapsedMs
    const withBoth = computeDailyScore([timed, untimed]).points;
    const timedOnly = computeDailyScore([timed]).points;
    // withBoth has one FEWER round's worth of points than timedOnly + untimed's
    // own points would suggest, specifically because the missing time voids
    // the speed bonus that timedOnly enjoys alone.
    expect(withBoth).toBe(timedOnly + 10 + 10 - 40); // untimed round's points, no speed bonus
  });

  it('faster total time earns a bigger speed tier', () => {
    const fast: RoundResult = { ...win('LIST', 5, 5), elapsedMs: 30_000 };
    const slow: RoundResult = { ...win('LIST', 5, 5), elapsedMs: 400_000 };
    expect(computeDailyScore([fast]).points).toBeGreaterThan(computeDailyScore([slow]).points);
  });

  it('is a pure function of its input (same results → same score)', () => {
    const results = [win('LIST', 5, 5), win('MATCH', 2, 3, 1)];
    expect(computeDailyScore(results)).toEqual(computeDailyScore(results));
  });

  it('an empty day scores zero with zero max', () => {
    expect(computeDailyScore([])).toEqual({ points: 0, max: 0 });
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

describe('buildQuestionLink / questionParam', () => {
  it('LIST links keep the readable id (the id only restates the prompt)', () => {
    const q = list('list_pl_goals_overall_all_10');
    expect(buildQuestionLink(q, 'https://x.github.io', '/ball-knowledge/')).toBe(
      'https://x.github.io/ball-knowledge/?q=list_pl_goals_overall_all_10',
    );
  });
  it('CAREER links are opaque — no player name / id in the URL', () => {
    const q = career('career_dominic_solanke');
    const link = buildQuestionLink(q, 'https://x', '/');
    expect(link).not.toContain('solanke');
    expect(link).not.toContain('career_');
    expect(link).toMatch(/\?q=c[0-9a-z]+$/); // opaque token like ?q=c1a2b3
  });
  it('career token is stable for the same id', () => {
    expect(questionParam(career('career_x'))).toBe(questionParam(career('career_x')));
  });
  it('MATCH links stay readable — the id restates the visible fixture, not an answer', () => {
    // The score is shown, and the id names no scorer, so there is nothing to hide.
    const q = match('match_premier_league_2019-01-12_liverpool_arsenal');
    expect(buildQuestionLink(q, 'https://x', '/')).toBe(
      'https://x/?q=match_premier_league_2019-01-12_liverpool_arsenal',
    );
  });
});

describe('resolveQuestionParam', () => {
  const pool: Question[] = [
    list('list_pl_goals_overall_all_10'),
    career('career_dominic_solanke'),
    career('career_alan_shearer'),
  ];
  it('resolves a list id directly', () => {
    expect(resolveQuestionParam('list_pl_goals_overall_all_10', pool)?.id).toBe(
      'list_pl_goals_overall_all_10',
    );
  });
  it('resolves a career hash token back to the right question', () => {
    const token = questionParam(career('career_dominic_solanke'));
    expect(resolveQuestionParam(token, pool)?.id).toBe('career_dominic_solanke');
  });
  it('resolves a match id directly', () => {
    const withMatch = [...pool, match('match_pl_2019-01-12_a_b')];
    expect(resolveQuestionParam('match_pl_2019-01-12_a_b', withMatch)?.id).toBe(
      'match_pl_2019-01-12_a_b',
    );
  });
  it('returns null for an unknown / stale param', () => {
    expect(resolveQuestionParam('nope', pool)).toBeNull();
    expect(resolveQuestionParam('career_dominic_solanke', pool)?.id).toBe('career_dominic_solanke'); // literal id still works as a safety net
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
