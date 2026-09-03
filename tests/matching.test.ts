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
  it('transliterates special Latin letters NFD misses', () => {
    expect(normalize('Groß')).toBe('gross'); // German eszett
    expect(normalize('Håland')).toBe('haland');
    expect(normalize('Kjær')).toBe('kjaer');
    expect(normalize('Błaszczykowski')).toBe('blaszczykowski');
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
  it('accepts the anglicized spelling of ß (Groß → Gross / Gros)', () => {
    const gross = p('Pascal Groß', 'Groß');
    expect(isMatch('Gross', gross)).toBe(true); // exact after transliteration
    expect(isMatch('Gros', gross)).toBe(true); // 1-edit typo tolerance
    expect(isMatch('Groß', gross)).toBe(true); // original spelling still works
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

describe('matchAnswer — first name', () => {
  // Some players are universally known by their first name, while the stored
  // surname is something nobody says ("Júnior", "Becker"). Both must count.
  const vinicius = p('Vinícius Júnior', 'Júnior');
  const alisson = p('Alisson Becker', 'Becker');

  it('accepts the first name alone', () => {
    expect(isMatch('Vinicius', vinicius)).toBe(true);
    expect(isMatch('Alisson', alisson)).toBe(true);
  });
  it('still accepts the surname and the full name', () => {
    expect(isMatch('Junior', vinicius)).toBe(true);
    expect(isMatch('Vinicius Junior', vinicius)).toBe(true);
    expect(isMatch('Becker', alisson)).toBe(true);
  });
  it('does not accept a middle name', () => {
    expect(isMatch('Maria', p('José María Giménez', 'Giménez'))).toBe(false);
  });
  it('does not turn a surname particle into an answer', () => {
    // "van"/"de" are name fragments, not guesses — they must never score.
    expect(isMatch('van', p('Robin van Persie', 'van Persie'))).toBe(false);
    expect(isMatch('de', p('Kevin De Bruyne', 'De Bruyne'))).toBe(false);
    // ...and a sub-3-char first token is not added either.
    expect(isMatch('El', p('El Hadji Diouf', 'Diouf'))).toBe(false);
  });
  it('picks the right player when two share a first name', () => {
    const jesus = p('Gabriel Jesus', 'Jesus');
    const martinelli = p('Gabriel Martinelli', 'Martinelli');
    // Ambiguous on "Gabriel", but the surnames still resolve exactly.
    expect(matchAnswer('Martinelli', [jesus, martinelli])?.candidate.lastName).toBe('Martinelli');
    expect(matchAnswer('Jesus', [jesus, martinelli])?.candidate.lastName).toBe('Jesus');
  });
});

describe('matchAnswer — accented names accept their plain spelling', () => {
  // Regression guard: every diacritic present in the generated dataset must fold
  // to ASCII, so a player never has to type an accent they can't reach.
  const cases: Array<[string, Player]> = [
    ['Vinicius', p('Vinícius Júnior', 'Júnior')],
    ['Junior', p('Vinícius Júnior', 'Júnior')],
    ['Higuain', p('Gonzalo Higuaín', 'Higuaín')],
    ['Ismaila', p('Ismaïla Sarr', 'Sarr')],
    ['Gundogan', p('İlkay Gündoğan', 'Gündoğan')], // dotted capital I + g-breve
    ['Di Maria', p('Ángel Di María', 'Di María')],
    ['Martinez', p('Emiliano Martínez', 'Martínez')],
    ['Hojlund', p('Rasmus Højlund', 'Højlund')], // ø via transliteration
  ];
  for (const [guess, player] of cases) {
    it(`accepts "${guess}" for ${player.fullName}`, () => {
      expect(isMatch(guess, player)).toBe(true);
    });
  }
  it('accepts the original accented spelling too', () => {
    expect(isMatch('Higuaín', p('Gonzalo Higuaín', 'Higuaín'))).toBe(true);
    expect(isMatch('Vinícius', p('Vinícius Júnior', 'Júnior'))).toBe(true);
  });
});

describe('matchAnswer — noAutoTokens (club answers)', () => {
  // A club-shaped Player: fullName is the full club name, lastName is the
  // API's own club-specific short name (never a derived word split).
  const club = (fullName: string, shortName: string, aliases?: string[]): Player => ({
    fullName,
    lastName: shortName,
    aliases,
    noAutoTokens: true,
  });

  it('still accepts the full name and the short name', () => {
    const manUtd = club('Manchester United', 'Man Utd');
    expect(isMatch('Manchester United', manUtd)).toBe(true);
    expect(isMatch('Man Utd', manUtd)).toBe(true);
  });

  it('does NOT accept a bare word shared with another club\'s full name', () => {
    // Without noAutoTokens, "United" would be auto-derived from BOTH full
    // names and ambiguously match whichever club is checked first — the
    // exact failure mode this flag exists to prevent.
    const manUtd = club('Manchester United', 'Man Utd');
    const newcastle = club('Newcastle United', 'Newcastle');
    expect(isMatch('United', manUtd)).toBe(false);
    expect(isMatch('United', newcastle)).toBe(false);
    // ...whereas the SAME shape without the flag would wrongly accept it.
    const unguarded: Player = { fullName: 'Manchester United', lastName: 'Man Utd' };
    expect(isMatch('United', unguarded)).toBe(true);
  });

  it('does not derive a bare first word either (Manchester City vs Manchester United)', () => {
    const manUtd = club('Manchester United', 'Man Utd');
    expect(isMatch('Manchester', manUtd)).toBe(false);
  });

  it('two clubs sharing a word each resolve only to their own short name', () => {
    const manUtd = club('Manchester United', 'Man Utd');
    const manCity = club('Manchester City', 'Man City');
    expect(matchAnswer('Man Utd', [manUtd, manCity])?.candidate.lastName).toBe('Man Utd');
    expect(matchAnswer('Man City', [manUtd, manCity])?.candidate.lastName).toBe('Man City');
  });
});
