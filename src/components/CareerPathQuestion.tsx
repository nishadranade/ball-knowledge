import type { CareerPathQuestion as CareerQ } from '../game/types';
import { useGame } from '../game/useGame';
import { GuessInput } from './GuessInput';
import { Lives } from './Lives';

interface Props {
  question: CareerQ;
  onNext: () => void;
}

export function CareerPathQuestion({ question, onNext }: Props) {
  const { state, guess, giveUp, livesLeft } = useGame(question);
  const over = state.status !== 'in-progress';

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
          <button onClick={onNext}>Next question →</button>
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
