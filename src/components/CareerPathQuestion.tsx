import { useEffect, useRef } from 'react';
import type { CareerPathQuestion as CareerQ } from '../game/types';
import { useGame } from '../game/useGame';
import { useElapsedTime } from '../game/useElapsedTime';
import type { RoundResult } from '../game/daily';
import { GuessInput } from './GuessInput';
import { Lives } from './Lives';

interface Props {
  question: CareerQ;
  onNext?: () => void;
  nextLabel?: string;
  /** Fired once when the round ends (won or lost). */
  onComplete?: (result: RoundResult) => void;
}

export function CareerPathQuestion({
  question,
  onNext,
  nextLabel = 'Next question →',
  onComplete,
}: Props) {
  const { state, guess, giveUp, livesLeft } = useGame(question);
  const over = state.status !== 'in-progress';

  // Paused while the tab/window isn't visible (reset on remount via `key`).
  const getElapsedMs = useElapsedTime();
  const reported = useRef(false);
  useEffect(() => {
    if (over && !reported.current) {
      reported.current = true;
      onComplete?.({
        format: 'CAREER_PATH',
        found: state.status === 'won' ? 1 : 0,
        total: 1,
        wrong: state.wrong,
        maxWrong: question.maxWrong,
        won: state.status === 'won',
        elapsedMs: getElapsedMs(),
      });
    }
  }, [over, onComplete, state, question, getElapsedMs]);

  return (
    <div className="question card">
      <p className="prompt">{question.prompt}</p>

      <table className="career">
        <thead>
          <tr>
            <th>Years</th>
            <th>Club</th>
            <th>Apps</th>
            <th>Goals</th>
          </tr>
        </thead>
        <tbody>
          {question.career.map((s, i) => (
            <tr key={i}>
              <td>{s.years}</td>
              <td>
                {s.club}
                {s.loan && <span className="loan"> (loan)</span>}
              </td>
              <td>{s.appearances ?? '—'}</td>
              <td>{s.goals ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Lives max={question.maxWrong} left={livesLeft} />

      {state.lastFeedback && !over && (
        <p className={`feedback ${state.lastFeedback}`}>
          {state.lastFeedback === 'correct' && 'Correct!'}
          {state.lastFeedback === 'wrong' && 'Wrong — try again.'}
          {state.lastFeedback === 'duplicate' && 'You already guessed that.'}
        </p>
      )}

      {!over ? (
        <>
          <GuessInput onGuess={guess} placeholder="Which player is this?" />
          <button className="link-btn" onClick={giveUp}>
            Give up
          </button>
        </>
      ) : (
        <div className="round-end">
          <p className={state.status === 'won' ? 'result win' : 'result lose'}>
            {state.status === 'won' ? 'Correct — ' : 'The answer was '}
            <strong>{question.answer.fullName}</strong>
          </p>
          {onNext && <button onClick={onNext}>{nextLabel}</button>}
        </div>
      )}

      <p className="source">
        Source:{' '}
        <a href={question.source.url} target="_blank" rel="noreferrer">
          Wikipedia
        </a>
      </p>
    </div>
  );
}
