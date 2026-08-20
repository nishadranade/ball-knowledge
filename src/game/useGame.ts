import { useMemo, useReducer } from 'react';
import type { Question, Player } from './types';
import { matchAnswer } from './matching';

export type RoundStatus = 'in-progress' | 'won' | 'lost';

export interface FoundEntry {
  index: number; // index into the answer list (LIST) — identifies which slot was filled
  player: Player;
}

export interface GameState {
  wrong: number;
  found: FoundEntry[];
  status: RoundStatus;
  lastFeedback: 'correct' | 'wrong' | 'duplicate' | null;
}

type Action = { type: 'guess'; value: string } | { type: 'giveUp' } | { type: 'reset' };

/** Candidate players for the current question: every answer for LIST, MATCH
 *  (its distinct scorers) and SQUAD (its starting XI); the single player for
 *  CAREER_PATH. */
function candidatesOf(q: Question): Player[] {
  switch (q.format) {
    case 'LIST':
    case 'MATCH':
    case 'SQUAD':
      return q.answers;
    case 'CAREER_PATH':
      return [q.answer];
  }
}

/** LIST, MATCH and SQUAD all key off q.answers.length — only CAREER_PATH differs. */
function totalTargets(q: Question): number {
  return q.format === 'CAREER_PATH' ? 1 : q.answers.length;
}

function makeReducer(q: Question) {
  const candidates = candidatesOf(q);
  return function reducer(state: GameState, action: Action): GameState {
    if (action.type === 'reset') {
      return { wrong: 0, found: [], status: 'in-progress', lastFeedback: null };
    }
    if (state.status !== 'in-progress') return state;

    if (action.type === 'giveUp') {
      return { ...state, status: 'lost', lastFeedback: null };
    }

    // action.type === 'guess'
    const foundIdx = new Set(state.found.map((f) => f.index));
    const remaining = candidates
      .map((player, index) => ({ player, index }))
      .filter((c) => !foundIdx.has(c.index));

    const result = matchAnswer(
      action.value,
      remaining.map((r) => r.player),
    );

    if (!result) {
      // Was it a duplicate of something already found? Don't penalize.
      const dup = matchAnswer(
        action.value,
        state.found.map((f) => f.player),
      );
      if (dup) return { ...state, lastFeedback: 'duplicate' };

      const wrong = state.wrong + 1;
      const status: RoundStatus = wrong >= q.maxWrong ? 'lost' : 'in-progress';
      return { ...state, wrong, status, lastFeedback: 'wrong' };
    }

    // Correct — find which remaining slot it filled.
    const slot = remaining.find((r) => r.player === result.candidate)!;
    const found = [...state.found, { index: slot.index, player: slot.player }];
    const status: RoundStatus = found.length >= totalTargets(q) ? 'won' : 'in-progress';
    return { ...state, found, status, lastFeedback: 'correct' };
  };
}

export function useGame(q: Question) {
  const reducer = useMemo(() => makeReducer(q), [q]);
  const [state, dispatch] = useReducer(reducer, {
    wrong: 0,
    found: [],
    status: 'in-progress',
    lastFeedback: null,
  });

  return {
    state,
    guess: (value: string) => dispatch({ type: 'guess', value }),
    giveUp: () => dispatch({ type: 'giveUp' }),
    reset: () => dispatch({ type: 'reset' }),
    livesLeft: Math.max(0, q.maxWrong - state.wrong),
  };
}
