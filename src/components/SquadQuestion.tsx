import { useEffect, useRef } from 'react';
import type { SquadQuestion as SquadQ } from '../game/types';
import { useGame } from '../game/useGame';
import { useElapsedTime } from '../game/useElapsedTime';
import type { RoundResult } from '../game/daily';
import { GuessInput } from './GuessInput';
import { Lives } from './Lives';

interface Props {
  question: SquadQ;
  onNext?: () => void;
  nextLabel?: string;
  /** Fired once when the round ends (all 11 found, or lives exhausted). */
  onComplete?: (result: RoundResult) => void;
}

/**
 * A real starting XI, laid out on a pitch by shirt number — name every player.
 * Structurally a list round (11 slots instead of a handful), so it runs on the
 * same shared `useGame` reducer as List/Match and inherits lives, duplicate
 * handling and fuzzy matching unchanged; only the layout is different.
 */
export function SquadQuestion({ question, onNext, nextLabel = 'Next question →', onComplete }: Props) {
  const { squad } = question;
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
        format: 'SQUAD',
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

  // Attackers at the top of the pitch, keeper at the bottom — the usual
  // broadcast-graphic convention. `lines` comes GK-first from the data.
  const rows = [...question.lines].reverse();

  return (
    <div className="question card">
      <p className="prompt">{question.prompt}</p>

      <p className="squad-header">
        {squad.team} <span className="match-score">({squad.home ? 'H' : 'A'})</span> vs {squad.opponent}{' '}
        <span className="match-score">
          {squad.home ? `${squad.teamScore}–${squad.opponentScore}` : `${squad.opponentScore}–${squad.teamScore}`}
        </span>
      </p>
      <p className="squad-meta">
        {squad.dateLabel}
        {squad.round && <> · {squad.round}</>} · {squad.formation}
      </p>

      <div className="pitch">
        {rows.map((row, ri) => (
          <div className="pitch-row" key={ri}>
            {row.map((idx) => {
              const a = question.answers[idx];
              const found = foundByIndex.get(idx);
              const reveal = over && !found;
              return (
                <div key={idx} className={found ? 'pitch-slot filled' : reveal ? 'pitch-slot revealed' : 'pitch-slot'}>
                  <span className="shirt">{a.shirtNumber}</span>
                  <span className="pitch-name">{found ? found.fullName : reveal ? a.fullName : ''}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <Lives max={question.maxWrong} left={livesLeft} />

      {state.lastFeedback && !over && (
        <p className={`feedback ${state.lastFeedback}`}>
          {state.lastFeedback === 'correct' && 'Nice!'}
          {state.lastFeedback === 'wrong' && "Didn't start this game."}
          {state.lastFeedback === 'duplicate' && 'Already found that one.'}
        </p>
      )}

      {!over ? (
        <>
          <GuessInput onGuess={guess} placeholder="Who started?" />
          <button className="link-btn" onClick={giveUp}>
            Give up
          </button>
        </>
      ) : (
        <div className="round-end">
          <p className={state.status === 'won' ? 'result win' : 'result lose'}>
            {state.status === 'won'
              ? `Full XI found with ${livesLeft} guess${livesLeft === 1 ? '' : 'es'} to spare!`
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
