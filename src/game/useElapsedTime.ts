import { useEffect, useRef } from 'react';
import { createElapsedTimer } from './elapsedTimer';

/**
 * Wall-clock elapsed time since mount, PAUSED while the tab/window isn't
 * visible — see elapsedTimer.ts for why. Every question component uses this
 * instead of a bare `Date.now() - startedAt` ref; call the returned function
 * once, at round-end, to get the final ms for `RoundResult.elapsedMs`.
 */
export function useElapsedTime(): () => number {
  const timerRef = useRef(createElapsedTimer(Date.now(), document.visibilityState === 'hidden'));
  // Stable identity across re-renders (it closes over the ref, not any
  // render's values), so it's safe to drop straight into a useEffect
  // dependency array without causing that effect to re-fire every render.
  const getElapsedMsRef = useRef(() => timerRef.current.elapsedMs(Date.now()));

  useEffect(() => {
    const onVisibilityChange = () => {
      const now = Date.now();
      if (document.visibilityState === 'hidden') timerRef.current.pause(now);
      else timerRef.current.resume(now);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  return getElapsedMsRef.current;
}
