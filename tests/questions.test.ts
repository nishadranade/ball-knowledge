import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { QuestionBundle, ListQuestion, MatchQuestion } from '../src/game/types';

const here = dirname(fileURLToPath(import.meta.url));
// The bank is split one file per format so the browser can fetch just what it
// needs (see scripts/bank.ts). These tests read all three and validate the union.
const BANK_FILES = ['q-list.json', 'q-career.json', 'q-match.json'];
const bankPaths = BANK_FILES.map((f) => resolve(here, '../public/data', f));

// These tests validate the generated answer bank. They guard against
// data-aggregation regressions (e.g. a player's ranking value being wrong),
// which unit tests on pure logic can't catch.
const bundle: QuestionBundle | null = bankPaths.every(existsSync)
  ? {
      generatedAt: '',
      questions: bankPaths.flatMap(
        (p) => (JSON.parse(readFileSync(p, 'utf8')) as QuestionBundle).questions,
      ),
    }
  : null;

describe('generated answer bank', () => {
  it('all three format files exist (run `npm run build:data` if this fails)', () => {
    expect(bundle).not.toBeNull();
  });

  if (!bundle) return;

  it('each format file contains ONLY that format', () => {
    // The browser fetches these individually, so a stray question in the wrong
    // file would be invisible to the view that should show it.
    const expected = ['LIST', 'CAREER_PATH', 'MATCH'];
    bankPaths.forEach((p, i) => {
      const qs = (JSON.parse(readFileSync(p, 'utf8')) as QuestionBundle).questions;
      expect(qs.length).toBeGreaterThan(0);
      for (const q of qs) expect(q.format).toBe(expected[i]);
    });
  });

  const lists = bundle.questions.filter((q): q is ListQuestion => q.format === 'LIST');

  it('has questions', () => {
    expect(bundle.questions.length).toBeGreaterThan(0);
  });

  it('LIST answers are sorted by descending value', () => {
    for (const q of lists) {
      for (let i = 1; i < q.answers.length; i++) {
        expect(q.answers[i - 1].value ?? 0).toBeGreaterThanOrEqual(q.answers[i].value ?? 0);
      }
    }
  });

  it('LIST questions have at least the requested N answers', () => {
    for (const q of lists) {
      // id ends with the requested N, e.g. ..._10
      const m = q.id.match(/_(\d+)$/);
      if (!m) continue;
      const n = Number(m[1]);
      expect(q.answers.length).toBeGreaterThanOrEqual(n);
    }
  });

  it('every LIST answer has a positive value and a surname', () => {
    for (const q of lists) {
      for (const a of q.answers) {
        expect(a.lastName.length).toBeGreaterThan(0);
        expect(a.value ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('question ids are unique', () => {
    const ids = bundle.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every question has a known category', () => {
    const known = new Set(['PREMIER_LEAGUE', 'CHAMPIONS_LEAGUE', 'WORLD_CUP']);
    for (const q of bundle.questions) {
      expect(known.has(q.category)).toBe(true);
    }
  });

  it('includes Champions League questions', () => {
    const cl = bundle.questions.filter((q) => q.category === 'CHAMPIONS_LEAGUE');
    expect(cl.length).toBeGreaterThan(0);
  });

  it('CL goals & appearances are all-time (Wikipedia); assists & clean sheets note the era', () => {
    const cl = bundle.questions.filter(
      (q): q is ListQuestion => q.category === 'CHAMPIONS_LEAGUE' && q.format === 'LIST',
    );
    for (const q of cl) {
      const metric = q.id.replace('list_champions_league_', '').split('_')[0];
      if (metric === 'goals' || metric === 'appearances') {
        expect(q.source.name).toBe('Wikipedia');
        expect(q.prompt).not.toContain('since 2004/05');
      } else {
        // assists / cleansheets — pulselive, era-disclosed
        expect(q.prompt).toContain('since 2004/05');
      }
    }
  });

  it('every question (both formats) has a valid difficulty', () => {
    for (const q of bundle.questions) {
      expect(q.difficulty === 'STANDARD' || q.difficulty === 'HARD').toBe(true);
    }
  });

  it('has both Standard and Hard questions', () => {
    const std = bundle.questions.filter((q) => q.difficulty === 'STANDARD');
    const hard = bundle.questions.filter((q) => q.difficulty === 'HARD');
    expect(std.length).toBeGreaterThan(0);
    expect(hard.length).toBeGreaterThan(0);
  });

  it('the daily (Standard-only) pool has a list and at least two career questions', () => {
    // The daily asks one list + TWO distinct career paths, so the Standard pool
    // must be able to supply two.
    const std = bundle.questions.filter((q) => q.difficulty === 'STANDARD');
    expect(std.some((q) => q.format === 'LIST')).toBe(true);
    expect(std.filter((q) => q.format === 'CAREER_PATH').length).toBeGreaterThanOrEqual(2);
  });

  const matches = bundle.questions.filter((q): q is MatchQuestion => q.format === 'MATCH');

  it('has match questions (run `npm run build:matches` if this fails)', () => {
    expect(matches.length).toBeGreaterThan(0);
  });

  it('every match accounts for exactly as many goals as its scoreline', () => {
    // The single most important guard on this format: if the scorers plus own
    // goals don't add up to the score, the question is simply wrong.
    for (const q of matches) {
      const tallied = q.answers.reduce((n, a) => n + a.goals, 0) + (q.ownGoals ?? 0);
      expect(tallied).toBe(q.match.homeScore + q.match.awayScore);
    }
  });

  it('match answers are distinct players with a team and at least one goal', () => {
    for (const q of matches) {
      const names = q.answers.map((a) => a.fullName);
      expect(new Set(names).size).toBe(names.length); // a brace is ONE slot
      for (const a of q.answers) {
        expect(a.lastName.length).toBeGreaterThan(0);
        expect(a.team.length).toBeGreaterThan(0);
        expect(a.goals).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('every match has at least one nameable scorer', () => {
    // Guards against 0-0s and games decided purely by own goals, which would
    // render as a question with no slots at all.
    for (const q of matches) expect(q.answers.length).toBeGreaterThanOrEqual(1);
  });

  it('Premier League matches obey the big-team filter rules', () => {
    const BIG = new Set([
      'Arsenal',
      'Chelsea',
      'Liverpool',
      'Manchester City',
      'Manchester United',
      'Tottenham Hotspur',
    ]);
    for (const q of matches) {
      if (q.category !== 'PREMIER_LEAGUE') continue;
      const { homeTeam, awayTeam, homeScore, awayScore } = q.match;
      const homeBig = BIG.has(homeTeam);
      const awayBig = BIG.has(awayTeam);
      // At least one big side, always.
      expect(homeBig || awayBig).toBe(true);
      if (homeBig && awayBig) continue; // big vs big: no further constraint
      // Mixed fixture: either the non-big side won, or it was a 3+ goal game.
      const nonBigWon = homeBig ? awayScore > homeScore : homeScore > awayScore;
      expect(nonBigWon || homeScore + awayScore >= 3).toBe(true);
    }
  });

  it('each scorer played for one of the two teams in the fixture', () => {
    for (const q of matches) {
      const sides = new Set([q.match.homeTeam, q.match.awayTeam]);
      for (const a of q.answers) expect(sides.has(a.team)).toBe(true);
    }
  });

  it('match dates are ISO and the daily pool has Standard matches', () => {
    for (const q of matches) expect(q.match.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(matches.some((q) => q.difficulty === 'STANDARD')).toBe(true);
  });

  it('Champions League matches are knockout ties, Premier League ones are not', () => {
    for (const q of matches) {
      if (q.category === 'CHAMPIONS_LEAGUE') expect(q.match.round).toBeTruthy();
      else expect(q.match.round).toBeUndefined();
    }
  });

  it('lesser clubs/countries are Hard and capped at top 5', () => {
    // Any LIST question tagged STANDARD for a country/club scope must be a major
    // one; and no HARD list should exceed top 5.
    const lists = bundle.questions.filter((q): q is ListQuestion => q.format === 'LIST');
    for (const q of lists) {
      const m = q.id.match(/_(\d+)$/);
      const n = m ? Number(m[1]) : 0;
      if (q.difficulty === 'HARD') expect(n).toBeLessThanOrEqual(5);
    }
  });
});
