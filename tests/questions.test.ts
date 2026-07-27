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
});
