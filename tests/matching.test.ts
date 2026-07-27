import { describe, it, expect } from 'vitest';
import { normalize, matchAnswer, isMatch, typoBudget } from '../src/game/matching';
import type { Player } from '../src/game/types';

const p = (fullName: string, lastName: string, aliases?: string[]): Player => ({
  fullName,
  lastName,
  aliases,
});

describe('normalize', () => {
  it('strips diacritics', () => {
    expect(normalize('Özil')).toBe('ozil');
    expect(normalize('Rösler')).toBe('rosler');
    expect(normalize('Čech')).toBe('cech');
  });
  it('lowercases and trims', () => {
    expect(normalize('  Shearer  ')).toBe('shearer');
  });
  it('turns punctuation into spaces', () => {
    expect(normalize("O'Neil")).toBe('o neil');
    expect(normalize('Aubameyang-Smith')).toBe('aubameyang smith');
  });
});

describe('typoBudget', () => {
  it('scales with length', () => {
    expect(typoBudget(3)).toBe(0);
    expect(typoBudget(5)).toBe(1);
    expect(typoBudget(8)).toBe(2);
    expect(typoBudget(12)).toBe(3);
  });
});

describe('matchAnswer — last name only', () => {
  const shearer = p('Alan Shearer', 'Shearer');
  it('accepts last name alone', () => {
    expect(isMatch('Shearer', shearer)).toBe(true);
  });
  it('accepts full name', () => {
    expect(isMatch('Alan Shearer', shearer)).toBe(true);
  });
  it('is case-insensitive', () => {
    expect(isMatch('shearer', shearer)).toBe(true);
  });
});

describe('matchAnswer — typo tolerance', () => {
  it('forgives a single-letter typo in a surname', () => {
    expect(isMatch('Lewandoski', p('Robert Lewandowski', 'Lewandowski'))).toBe(true);
    expect(isMatch('Shmeichel', p('Peter Schmeichel', 'Schmeichel'))).toBe(true);
  });
  it('forgives missing diacritic', () => {
    expect(isMatch('Ozil', p('Mesut Özil', 'Özil'))).toBe(true);
    expect(isMatch('Rosler', p('Uwe Rösler', 'Rösler'))).toBe(true);
  });
  it('forgives a transposition in a longer name', () => {
    expect(isMatch('Aubemayang', p('Pierre-Emerick Aubameyang', 'Aubameyang'))).toBe(true);
  });
});

describe('matchAnswer — rejects wrong guesses', () => {
  it('does not match an unrelated name', () => {
    expect(isMatch('Ronaldo', p('Alan Shearer', 'Shearer'))).toBe(false);
  });
  it('does not let a short guess swallow a long surname', () => {
    expect(isMatch('Sha', p('Alan Shearer', 'Shearer'))).toBe(false);
  });
  it('does not match a different short surname within budget-abuse', () => {
    // "Kane" vs "Kean" is 1 edit but both len 4 (budget 1) — this is a genuine
    // ambiguity; ensure we still pick the RIGHT one when both are candidates.
    const kane = p('Harry Kane', 'Kane');
    const keane = p('Robbie Keane', 'Keane');
    const res = matchAnswer('Kane', [kane, keane]);
    expect(res?.candidate.fullName).toBe('Harry Kane'); // exact beats fuzzy
  });
});

describe('matchAnswer — best-of-many', () => {
  const candidates = [
    p('Alan Shearer', 'Shearer'),
    p('Wayne Rooney', 'Rooney'),
    p('Thierry Henry', 'Henry'),
  ];
  it('picks the correct candidate from a list', () => {
    expect(matchAnswer('rooney', candidates)?.candidate.lastName).toBe('Rooney');
  });
  it('returns null when nothing matches', () => {
    expect(matchAnswer('messi', candidates)).toBeNull();
  });
  it('prefers exact match over a fuzzy one', () => {
    const res = matchAnswer('Henry', candidates);
    expect(res?.editDistance).toBe(0);
  });
});

describe('matchAnswer — aliases', () => {
  it('matches a known alias', () => {
    const player = p('Ederson', 'Ederson', ['Ederson Moraes']);
    expect(isMatch('Ederson Moraes', player)).toBe(true);
  });
});
