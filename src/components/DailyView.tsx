import { useMemo, useState, useCallback } from 'react';
import type { Question } from '../game/types';
import {
  selectDaily,
  dateKey,
  dayNumber,
  buildShareText,
  type RoundResult,
  type DailyResult,
} from '../game/daily';
import { ListQuestion } from './ListQuestion';
import { CareerPathQuestion } from './CareerPathQuestion';

interface Props {
  all: Question[];
}

interface StoredDaily {
  date: string;
  results: RoundResult[];
  completed: boolean;
}

const STORAGE_KEY = 'footy-quiz-daily';
const STREAK_KEY = 'footy-quiz-streak';

function loadStored(date: string): StoredDaily | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDaily;
    return parsed.date === date ? parsed : null;
  } catch {
    return null;
  }
}

function saveStored(s: StoredDaily) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore (private mode etc.) */
  }
}

/** Update the streak when a daily completes. Returns the new streak count. */
function bumpStreak(day: number): number {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    const prev = raw ? (JSON.parse(raw) as { lastDay: number; count: number }) : null;
    let count = 1;
    if (prev) {
      if (prev.lastDay === day) return prev.count; // already counted today
      if (prev.lastDay === day - 1) count = prev.count + 1; // consecutive
    }
    localStorage.setItem(STREAK_KEY, JSON.stringify({ lastDay: day, count }));
    return count;
  } catch {
    return 1;
  }
}

export function DailyView({ all }: Props) {
  const date = dateKey();
  const day = dayNumber();
  const daily = useMemo(() => selectDaily(all, date), [all, date]);

  // Ordered daily questions (list first, then career).
  const questions = useMemo(
    () => [daily.list, daily.career].filter((q): q is Question => q != null),
    [daily],
  );

  const stored = useMemo(() => loadStored(date), [date]);
  const [results, setResults] = useState<RoundResult[]>(stored?.results ?? []);
  const [step, setStep] = useState(stored?.completed ? questions.length : 0);
  const [streak, setStreak] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const done = step >= questions.length;

  const handleComplete = useCallback(
    (r: RoundResult) => {
      setResults((prev) => {
        const nextResults = [...prev, r];
        const completed = nextResults.length >= questions.length;
        saveStored({ date, results: nextResults, completed });
        if (completed) setStreak(bumpStreak(day));
        return nextResults;
      });
    },
    [date, day, questions.length],
  );

  const advance = () => setStep((s) => s + 1);

  const dailyResult: DailyResult = { day, results };

  const share = async () => {
    const text = buildShareText(dailyResult);
    try {
      if (navigator.share) {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* user cancelled share, or clipboard blocked */
    }
  };

  if (!questions.length) {
    return <p>No daily available.</p>;
  }

  // Results / share screen (fresh completion or already played today).
  if (done) {
    return (
      <div className="question card daily-result">
        <h2>Footy Quiz #{day}</h2>
        <pre className="share-grid">{buildShareText(dailyResult)}</pre>
        {streak != null && streak > 1 && <p className="streak">🔥 {streak}-day streak</p>}
        <button onClick={share}>{copied ? 'Copied!' : 'Share result'}</button>
        <p className="daily-note">Come back tomorrow for a new challenge. Or hit Practice above.</p>
      </div>
    );
  }

  const q = questions[step];
  const isLast = step === questions.length - 1;
  const nextLabel = isLast ? 'See result →' : 'Next question →';

  return (
    <div>
      <p className="daily-progress">
        Daily · question {step + 1} of {questions.length}
      </p>
      {q.format === 'LIST' ? (
        <ListQuestion key={q.id} question={q} onComplete={handleComplete} onNext={advance} nextLabel={nextLabel} />
      ) : (
        <CareerPathQuestion
          key={q.id}
          question={q}
          onComplete={handleComplete}
          onNext={advance}
          nextLabel={nextLabel}
        />
      )}
    </div>
  );
}
