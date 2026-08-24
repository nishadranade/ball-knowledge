import { describe, it, expect } from 'vitest';
import { orderPitchRows } from '../src/components/SquadQuestion';

/**
 * The pitch-layout bug this guards against: the source data lists each line
 * right-to-left (e.g. right-back before left-back within the defensive
 * row — confirmed against the raw pulselive fixture data), and pitch rows
 * come goalkeeper-first. Neither matches how a football pitch is actually
 * drawn (attackers at the top, left-sided players on the visual left), so
 * both need flipping for display.
 */
describe('orderPitchRows', () => {
  it('reverses the row order (goalkeeper-first data → attackers-first display)', () => {
    const lines = [[0], [1, 2, 3, 4], [5, 6, 7], [8, 9, 10]]; // GK, DEF, MID, FWD
    const rows = orderPitchRows(lines);
    expect(rows).toEqual([[10, 9, 8], [7, 6, 5], [4, 3, 2, 1], [0]]); // FWD, MID, DEF, GK
  });

  it('mirrors each row (right-to-left source data → left-to-right display)', () => {
    // A single defensive line: source order is [RB, CB, CB, LB].
    const lines = [[10, 11, 12, 13]];
    const [row] = orderPitchRows(lines);
    // Displayed left-to-right, so the LAST source entry (LB) renders FIRST.
    expect(row).toEqual([13, 12, 11, 10]);
  });

  it('does not mutate the input', () => {
    const lines = [[1, 2], [3, 4]];
    const original = JSON.parse(JSON.stringify(lines));
    orderPitchRows(lines);
    expect(lines).toEqual(original);
  });

  it('handles a single-row (e.g. GK-only) input without erroring', () => {
    expect(orderPitchRows([[0]])).toEqual([[0]]);
  });
});
