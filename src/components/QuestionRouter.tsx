import type { Question } from '../game/types';
import { ListQuestion } from './ListQuestion';
import { CareerPathQuestion } from './CareerPathQuestion';

interface Props {
  question: Question;
  onNext: () => void;
}

/** Render the right component for a question's format. `key` forces a fresh
 *  game state (via useReducer init) whenever the question changes. */
export function QuestionRouter({ question, onNext }: Props) {
  if (question.format === 'LIST') {
    return <ListQuestion key={question.id} question={question} onNext={onNext} />;
  }
  return <CareerPathQuestion key={question.id} question={question} onNext={onNext} />;
}
