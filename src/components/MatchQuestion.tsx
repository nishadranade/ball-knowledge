import { useEffect, useRef } from 'react';
import type { MatchQuestion as MatchQ } from '../game/types';
import { useGame } from '../game/useGame';
import { useElapsedTime } from '../game/useElapsedTime';
import type { RoundResult } from '../game/daily';
import { GuessInput } from './GuessInput';
import { Lives } from './Lives';

interface Props {
  question: MatchQ;
  onNext?: () => void;
  nextLabel?: string;
  /** Fired once when the round ends (all scorers found, or lives exhausted). */
  onComplete?: (result: RoundResult) => void;
}

/**
 * A real fixture with the score SHOWN — the player names that match's scorers.
 * Structurally a list round, so it runs on the shared `useGame` reducer and
 * inherits its lives, duplicate handling and fuzzy matching unchanged.
 */
export function MatchQuestion({ question, onNext, nextLabel = 'Next question →', onComplete }: Props) {
  const { match } = question;
  const { state, guess, giveUp, livesLeft } = useGame(question);
  const foundByIndex = new Map(state.found.map((f) => [f.index, f.player]));
  const over = state.status !== 'in-progress';

  const getElapsedMs = useElapsedTime();
  const reported = useRef(false);

  useEffect(() => {
    if (over && !reported.current) {
      reported.current = true;
      const foundIdx = new Set(state.found.map((f) => f.index));
      onComplete?.({
        format: 'MATCH',
        found: state.found.length,
        total: question.answers.length,
        wrong: state.wrong,
        maxWrong: question.maxWrong,
        won: state.status === 'won',
        slots: question.answers.map((_, i) => foundIdx.has(i)),
        elapsedMs: getElapsedMs(),
      });
    }
  }, [over, onComplete, state, question, getElapsedMs]);

  return (
    <div className="question card">
      <p className="prompt">{question.prompt}</p>

      <div className="match-header">
        <span className="match-team home">{match.homeTeam}</span>
        <span className="match-score">
          {match.homeScore}–{match.awayScore}
        </span>
        <span className="match-team away">{match.awayTeam}</span>
      </div>
      <p className="match-meta">
        {match.dateLabel}
        {match.round && <> · {match.round}</>}
      </p>

      {/* Own goals are excluded from the slots, so say so — otherwise the slot
          count looks like it contradicts the scoreline. */}
      <p className="match-ask">
        Name the {question.answers.length}{' '}
        {question.answers.length === 1 ? 'scorer' : 'scorers'}
        {question.ownGoals ? (
          <span className="match-og">
            {' '}
            (plus {question.ownGoals === 1 ? 'an own goal' : `${question.ownGoals} own goals`})
          </span>
        ) : null}
      </p>

      <ol className="answer-slots">
        {question.answers.map((a, i) => {
          const found = foundByIndex.get(i);
          const reveal = over && !found;
          return (
            <li key={i} className={found ? 'slot filled' : reveal ? 'slot revealed' : 'slot'}>
              <span className="slot-name">
                {found ? found.fullName : reveal ? a.fullName : '—'}
              </span>
              {(found || reveal) && (
                <span className="slot-value">
                  {a.team}
                  {a.goals > 1 && ` ×${a.goals}`}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <Lives max={question.maxWrong} left={livesLeft} />

      {state.lastFeedback && !over && (
        <p className={`feedback ${state.lastFeedback}`}>
          {state.lastFeedback === 'correct' && 'Nice!'}
          {state.lastFeedback === 'wrong' && "Didn't score in this game."}
          {state.lastFeedback === 'duplicate' && 'Already found that one.'}
        </p>
      )}

      {!over ? (
        <>
          <GuessInput onGuess={guess} placeholder="Who scored?" />
          <button className="link-btn" onClick={giveUp}>
            Give up
          </button>
        </>
      ) : (
        <div className="round-end">
          <p className={state.status === 'won' ? 'result win' : 'result lose'}>
            {state.status === 'won'
              ? `All ${question.answers.length} found with ${livesLeft} guess${livesLeft === 1 ? '' : 'es'} to spare!`
              : `Round over — you found ${state.found.length} of ${question.answers.length}.`}
          </p>
          {onNext && <button onClick={onNext}>{nextLabel}</button>}
        </div>
      )}

      <p className="source">
        Source:{' '}
        <a href={question.source.url} target="_blank" rel="noreferrer">
          {question.source.name}
        </a>
      </p>
    </div>
  );
}
