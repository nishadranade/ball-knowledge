import type { Question } from '../game/types';
import type { RoundResult } from '../game/daily';
import { ListQuestion } from './ListQuestion';
import { CareerPathQuestion } from './CareerPathQuestion';
import { MatchQuestion } from './MatchQuestion';

interface Props {
  question: Question;
  onNext?: () => void;
  nextLabel?: string;
  onComplete?: (result: RoundResult) => void;
}

/** Render the right component for a question's format. `key` forces a fresh
 *  game state (via useReducer init) whenever the question changes. */
export function QuestionRouter({ question, onNext, nextLabel, onComplete }: Props) {
  if (question.format === 'LIST') {
    return (
      <ListQuestion
        key={question.id}
        question={question}
        onNext={onNext}
        nextLabel={nextLabel}
        onComplete={onComplete}
      />
    );
  }
  if (question.format === 'MATCH') {
    return (
      <MatchQuestion
        key={question.id}
        question={question}
        onNext={onNext}
        nextLabel={nextLabel}
        onComplete={onComplete}
      />
    );
  }
  return (
    <CareerPathQuestion
      key={question.id}
      question={question}
      onNext={onNext}
      nextLabel={nextLabel}
      onComplete={onComplete}
    />
  );
}
