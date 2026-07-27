import { useEffect, useRef } from 'react';
import type { ListQuestion as ListQ } from '../game/types';
import { useGame } from '../game/useGame';
import type { RoundResult } from '../game/daily';
import { GuessInput } from './GuessInput';
import { Lives } from './Lives';

interface Props {
  question: ListQ;
  onNext?: () => void;
  nextLabel?: string;
  /** Fired once when the round ends (won or lost). */
  onComplete?: (result: RoundResult) => void;
}

export function ListQuestion({ question, onNext, nextLabel = 'Next question →', onComplete }: Props) {
  const { state, guess, giveUp, livesLeft } = useGame(question);
  const foundByIndex = new Map(state.found.map((f) => [f.index, f.player]));
  const over = state.status !== 'in-progress';

  // Report the outcome exactly once when the round ends.
  const reported = useRef(false);
  useEffect(() => {
    if (over && !reported.current) {
      reported.current = true;
      onComplete?.({
        format: 'LIST',
        found: state.found.length,
        total: question.answers.length,
        wrong: state.wrong,
        maxWrong: question.maxWrong,
        won: state.status === 'won',
      });
    }
  }, [over, onComplete, state, question]);

  return (
    <div className="question card">
      <p className="prompt">{question.prompt}</p>

      <ol className="answer-slots">
        {question.answers.map((a, i) => {
          const found = foundByIndex.get(i);
          const reveal = over && !found;
          return (
            <li key={i} className={found ? 'slot filled' : reveal ? 'slot revealed' : 'slot'}>
              <span className="slot-name">
                {found ? found.fullName : reveal ? a.fullName : '—'}
              </span>
              {(found || reveal) && a.value != null && <span className="slot-value">{a.value}</span>}
            </li>
          );
        })}
      </ol>

      <Lives max={question.maxWrong} left={livesLeft} />

      {state.lastFeedback && !over && (
        <p className={`feedback ${state.lastFeedback}`}>
          {state.lastFeedback === 'correct' && 'Nice!'}
          {state.lastFeedback === 'wrong' && 'Not on the list.'}
          {state.lastFeedback === 'duplicate' && 'Already found that one.'}
        </p>
      )}

      {!over ? (
        <>
          <GuessInput onGuess={guess} />
          <button className="link-btn" onClick={giveUp}>
            Give up
          </button>
        </>
      ) : (
        <div className="round-end">
          <p className={state.status === 'won' ? 'result win' : 'result lose'}>
            {state.status === 'won'
              ? `Solved with ${livesLeft} guess${livesLeft === 1 ? '' : 'es'} to spare!`
              : `Round over — you found ${state.found.length} of ${question.answers.length}.`}
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
