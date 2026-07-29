import { useEffect, useMemo, useState } from 'react';
import type { Question, Format, Category, Difficulty } from './game/types';
import type { DailySchedule } from './game/daily';
import { loadQuestions, loadDailySchedule } from './game/loadQuestions';
import { QuestionRouter } from './components/QuestionRouter';
import { DailyView } from './components/DailyView';

type FormatFilter = 'ALL' | Format;
type CategoryFilter = 'ALL' | Category;

const CATEGORY_LABELS: Record<Category, string> = {
  PREMIER_LEAGUE: 'Premier League',
  CHAMPIONS_LEAGUE: 'Champions League',
  WORLD_CUP: 'World Cup',
};

const FORMAT_LABELS: Record<FormatFilter, string> = {
  ALL: 'All',
  LIST: 'Top-N lists',
  CAREER_PATH: 'Career paths',
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  STANDARD: 'Standard',
  HARD: 'Hard',
};

// Deterministic shuffle seeded by an integer (avoids Math.random for stable dev).
function shuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed || 1;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Mode = 'DAILY' | 'PRACTICE';

export default function App() {
  const [all, setAll] = useState<Question[] | null>(null);
  const [schedule, setSchedule] = useState<DailySchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('DAILY');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL');
  const [difficulty, setDifficulty] = useState<Difficulty>('STANDARD');
  // Seed the shuffle randomly per session so every visit gets a different order
  // (bumped on filter change / deck wrap to reshuffle). Lazy init → evaluated once.
  const [order, setOrder] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [pos, setPos] = useState(0);

  useEffect(() => {
    loadQuestions()
      .then((b) => setAll(b.questions))
      .catch((e) => setError(String(e)));
    // Best-effort: the frozen daily schedule (null if absent → live fallback).
    loadDailySchedule().then(setSchedule).catch(() => setSchedule(null));
  }, []);

  // Which categories actually exist in the loaded data (drives the chip row).
  const categories = useMemo<Category[]>(() => {
    if (!all) return [];
    const order: Category[] = ['PREMIER_LEAGUE', 'CHAMPIONS_LEAGUE', 'WORLD_CUP'];
    const present = new Set(all.map((q) => q.category));
    return order.filter((c) => present.has(c));
  }, [all]);

  const deck = useMemo(() => {
    if (!all) return [];
    const filtered = all.filter(
      (q) =>
        (formatFilter === 'ALL' || q.format === formatFilter) &&
        (categoryFilter === 'ALL' || q.category === categoryFilter) &&
        // Difficulty applies to BOTH formats now (lists too).
        q.difficulty === difficulty,
    );
    return shuffle(filtered, order + 1);
  }, [all, formatFilter, categoryFilter, difficulty, order]);

  const current = deck[pos];

  const chooseFormat = (f: FormatFilter) => {
    setFormatFilter(f);
    setPos(0);
    setOrder((o) => o + 1);
  };

  const chooseCategory = (c: CategoryFilter) => {
    setCategoryFilter(c);
    setPos(0);
    setOrder((o) => o + 1);
  };

  const chooseDifficulty = (d: Difficulty) => {
    setDifficulty(d);
    setPos(0);
    setOrder((o) => o + 1);
  };

  const next = () => {
    setPos((p) => (p + 1 < deck.length ? p + 1 : 0));
    if (pos + 1 >= deck.length) setOrder((o) => o + 1); // reshuffle on wrap
  };

  if (error) return <div className="app"><p className="result lose">Error: {error}</p></div>;
  if (!all) return <div className="app"><p>Loading questions…</p></div>;

  return (
    <div className="app">
      <header>
        <h1>⚽ Ball Knowledge</h1>
        <p className="tagline">Name the players</p>
      </header>

      {/* Mode switch: Daily (shared challenge) vs Practice (free-play deck). */}
      <nav className="filters modes">
        {(['DAILY', 'PRACTICE'] as Mode[]).map((m) => (
          <button
            key={m}
            className={mode === m ? 'chip active' : 'chip'}
            onClick={() => setMode(m)}
          >
            {m === 'DAILY' ? 'Daily' : 'Practice'}
          </button>
        ))}
      </nav>

      {mode === 'DAILY' ? (
        <DailyView all={all} schedule={schedule} />
      ) : (
        <>
          {categories.length > 1 && (
            <nav className="filters">
              {(['ALL', ...categories] as CategoryFilter[]).map((c) => (
                <button
                  key={c}
                  className={categoryFilter === c ? 'chip active' : 'chip'}
                  onClick={() => chooseCategory(c)}
                >
                  {c === 'ALL' ? 'All competitions' : CATEGORY_LABELS[c]}
                </button>
              ))}
            </nav>
          )}

          <nav className="filters">
            {(['ALL', 'LIST', 'CAREER_PATH'] as FormatFilter[]).map((f) => (
              <button
                key={f}
                className={formatFilter === f ? 'chip active' : 'chip'}
                onClick={() => chooseFormat(f)}
              >
                {FORMAT_LABELS[f]}
              </button>
            ))}
            <span className="deck-count">
              {deck.length ? `${pos + 1} / ${deck.length}` : '0'}
            </span>
          </nav>

          {/* Difficulty applies to both formats: Hard adds lesser clubs/countries
              and rarer players. */}
          <nav className="filters">
            <span className="filter-label">Difficulty:</span>
            {(['STANDARD', 'HARD'] as Difficulty[]).map((d) => (
              <button
                key={d}
                className={difficulty === d ? 'chip active' : 'chip'}
                onClick={() => chooseDifficulty(d)}
              >
                {DIFFICULTY_LABELS[d]}
              </button>
            ))}
          </nav>

          {current ? (
            <QuestionRouter question={current} onNext={next} />
          ) : (
            <p>No questions for this filter.</p>
          )}
        </>
      )}

      <footer>
        <p>
          Player data from Wikipedia (CC BY-SA). Surnames alone count; minor typos are forgiven.
        </p>
      </footer>
    </div>
  );
}
