import { describe, it, expect } from 'vitest';
import { createElapsedTimer } from '../src/game/elapsedTimer';

/**
 * Pure pause-aware timer — every timestamp is passed in explicitly, so this
 * needs no DOM, no fake timers, no component rendering.
 */

describe('createElapsedTimer', () => {
  it('counts elapsed time normally when never paused', () => {
    const t = createElapsedTimer(0);
    expect(t.elapsedMs(1000)).toBe(1000);
    expect(t.elapsedMs(5000)).toBe(5000);
  });

  it('stops counting while paused', () => {
    const t = createElapsedTimer(0);
    t.pause(1000); // 1s active so far
    expect(t.elapsedMs(9000)).toBe(1000); // 8s of "hidden" time doesn't count
  });

  it('resumes counting from where it left off', () => {
    const t = createElapsedTimer(0);
    t.pause(1000); // 1s active
    t.resume(9000); // 8s hidden, not counted
    expect(t.elapsedMs(9500)).toBe(1500); // +0.5s active after resume
  });

  it('handles multiple pause/resume cycles', () => {
    const t = createElapsedTimer(0);
    t.pause(1000); // active: 0→1000 = 1000ms
    t.resume(2000); // hidden: 1000→2000, not counted
    t.pause(3000); // active: 2000→3000 = +1000ms
    t.resume(5000); // hidden: 3000→5000, not counted
    expect(t.elapsedMs(5500)).toBe(2500); // 1000 + 1000 + 500
  });

  it('a duplicate pause (or resume) call is a no-op, not a double-count', () => {
    const t = createElapsedTimer(0);
    t.pause(1000);
    t.pause(2000); // already paused — must not add another 1000ms
    expect(t.elapsedMs(3000)).toBe(1000);

    const t2 = createElapsedTimer(0);
    t2.resume(500); // already running — must not reset the span start
    expect(t2.elapsedMs(1000)).toBe(1000);
  });

  it('can start already paused (e.g. mounted while the tab is hidden)', () => {
    const t = createElapsedTimer(1000, true);
    expect(t.elapsedMs(5000)).toBe(0); // nothing counted while still hidden
    t.resume(5000);
    expect(t.elapsedMs(5300)).toBe(300);
  });
});
