/**
 * Pause-aware elapsed-time accumulator. Pure — no React, no DOM, no
 * `Date.now()` — every timestamp is passed in, so this is trivially unit
 * tested. `useElapsedTime` (in `src/game/useElapsedTime.ts`) is the thin
 * React wrapper that wires this to `document.visibilitychange` and the
 * real clock.
 *
 * WHY: before this, every question component timed itself as a bare
 * `Date.now() - startedAt`. That means switching tabs, backgrounding the
 * app, or just getting a notification mid-round counted as "slow" exactly
 * the same as not knowing the answer — the daily score's speed bonus could
 * be torched by an interruption that had nothing to do with football
 * knowledge. Pausing while hidden fixes that at the source.
 */
export interface ElapsedTimer {
  pause(atMs: number): void;
  resume(atMs: number): void;
  /** Active (non-paused) ms elapsed as of `atMs`. */
  elapsedMs(atMs: number): number;
}

export function createElapsedTimer(startMs: number, startPaused = false): ElapsedTimer {
  let accumulated = 0;
  let spanStart = startMs;
  let paused = startPaused;

  return {
    pause(atMs: number) {
      if (paused) return; // already paused — a duplicate event shouldn't double-count
      accumulated += atMs - spanStart;
      paused = true;
    },
    resume(atMs: number) {
      if (!paused) return;
      spanStart = atMs;
      paused = false;
    },
    elapsedMs(atMs: number) {
      return paused ? accumulated : accumulated + (atMs - spanStart);
    },
  };
}
