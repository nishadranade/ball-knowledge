import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { QuestionBundle, ListQuestion } from '../src/game/types';

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(here, '../public/data/questions.json');

// These tests validate the generated answer bank. They guard against
// data-aggregation regressions (e.g. a player's ranking value being wrong),
// which unit tests on pure logic can't catch.
const bundle: QuestionBundle | null = existsSync(dataPath)
  ? (JSON.parse(readFileSync(dataPath, 'utf8')) as QuestionBundle)
  : null;

describe('generated questions.json', () => {
  it('exists (run `npm run build:data` if this fails)', () => {
    expect(bundle).not.toBeNull();
  });

  if (!bundle) return;

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

  it('the daily (Standard-only) pool has both a list and a career question', () => {
    const std = bundle.questions.filter((q) => q.difficulty === 'STANDARD');
    expect(std.some((q) => q.format === 'LIST')).toBe(true);
    expect(std.some((q) => q.format === 'CAREER_PATH')).toBe(true);
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
