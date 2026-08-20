import { useEffect, useMemo, useState } from 'react';
import type { Question, Format, Category, Difficulty } from './game/types';
import {
  buildPracticeShareText,
  buildQuestionLink,
  dateKey,
  resolveQuestionParam,
  type DailySchedule,
  type RoundResult,
} from './game/daily';
import { loadFormats, loadDailySchedule, formatsNeeded } from './game/loadQuestions';
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
  MATCH: 'Match scorers',
  SQUAD: 'Starting XI',
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
  // The bank is fetched per format, on demand — `all` holds whatever the current
  // view has needed so far, not the whole 5.2MB bank. See game/loadQuestions.ts.
  const [all, setAll] = useState<Question[]>([]);
  const [schedule, setSchedule] = useState<DailySchedule | null>(null);
  /** The schedule fetch has settled (whether or not it produced a schedule). */
  const [scheduleReady, setScheduleReady] = useState(false);
  /** Which format set `all` currently holds, so we can tell "loaded" from
   *  "loaded something else" — switching filters narrows the bank. */
  const [loadedKey, setLoadedKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('DAILY');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL');
  const [difficulty, setDifficulty] = useState<Difficulty>('STANDARD');
  // Seed the shuffle randomly per session so every visit gets a different order
  // (bumped on filter change / deck wrap to reshuffle). Lazy init → evaluated once.
  const [order, setOrder] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [pos, setPos] = useState(0);
  // Deep link (?q=<id>): id requested in the URL, and whether it resolved.
  const [linkedId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('q');
  });
  const [linkMissing, setLinkMissing] = useState(false);
  // Result of the just-finished practice question (drives the share affordance).
  const [practiceResult, setPracticeResult] = useState<RoundResult | null>(null);
  const [copied, setCopied] = useState(false);

  // Any deep link (?q=) opens Practice.
  useEffect(() => {
    if (linkedId) setMode('PRACTICE');
  }, [linkedId]);

  // The frozen daily schedule is the FIRST and often ONLY fetch: a frozen day
  // carries its questions as full objects, so the daily needs no bank at all.
  useEffect(() => {
    loadDailySchedule()
      .then(setSchedule)
      .catch(() => setSchedule(null))
      .finally(() => setScheduleReady(true));
  }, []);

  // Is today's daily already frozen? null until we know, so we don't fetch the
  // bank speculatively and then discover it wasn't needed.
  const dayIsFrozen = scheduleReady ? Boolean(schedule?.[dateKey()]) : null;

  // Exactly the formats this view requires — the whole point of the split.
  const needed = formatsNeeded({ mode, formatFilter, linkedToken: linkedId, dayIsFrozen });
  const neededKey = needed.join(',');

  useEffect(() => {
    if (!neededKey) return; // nothing to fetch for this view
    let cancelled = false;
    loadFormats(neededKey.split(',') as Format[])
      .then((qs) => {
        if (cancelled) return;
        setAll(qs);
        setLoadedKey(neededKey);
        setError(null);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [neededKey]);

  /** Everything this view needs is in `all`. */
  const bankReady = neededKey === '' || loadedKey === neededKey;

  // A deep link that doesn't resolve once its format has loaded is stale.
  useEffect(() => {
    if (!linkedId || !bankReady) return;
    setLinkMissing(!resolveQuestionParam(linkedId, all));
  }, [linkedId, bankReady, all]);

  // Which categories actually exist in the loaded data (drives the chip row).
  const categories = useMemo<Category[]>(() => {
    const order: Category[] = ['PREMIER_LEAGUE', 'CHAMPIONS_LEAGUE', 'WORLD_CUP'];
    const present = new Set(all.map((q) => q.category));
    return order.filter((c) => present.has(c));
  }, [all]);

  // A resolved deep link pins the deck to that single question (played fresh);
  // otherwise the deck is the filtered + shuffled set.
  const linkedQuestion = useMemo(
    () => (linkedId ? resolveQuestionParam(linkedId, all) : null),
    [linkedId, all],
  );

  const deck = useMemo(() => {
    if (linkedQuestion) return [linkedQuestion];
    const filtered = all.filter(
      (q) =>
        (formatFilter === 'ALL' || q.format === formatFilter) &&
        (categoryFilter === 'ALL' || q.category === categoryFilter) &&
        // Difficulty applies to BOTH formats now (lists too).
        q.difficulty === difficulty,
    );
    return shuffle(filtered, order + 1);
  }, [all, linkedQuestion, formatFilter, categoryFilter, difficulty, order]);

  const current = deck[pos];

  // Moving to a different question clears the finished-question result/share.
  const chooseFormat = (f: FormatFilter) => {
    setFormatFilter(f);
    setPos(0);
    setOrder((o) => o + 1);
    setPracticeResult(null);
  };

  const chooseCategory = (c: CategoryFilter) => {
    setCategoryFilter(c);
    setPos(0);
    setOrder((o) => o + 1);
    setPracticeResult(null);
  };

  const chooseDifficulty = (d: Difficulty) => {
    setDifficulty(d);
    setPos(0);
    setOrder((o) => o + 1);
    setPracticeResult(null);
  };

  const next = () => {
    setPos((p) => (p + 1 < deck.length ? p + 1 : 0));
    if (pos + 1 >= deck.length) setOrder((o) => o + 1); // reshuffle on wrap
    setPracticeResult(null);
  };

  const sharePractice = async () => {
    if (!current || !practiceResult) return;
    const text = buildPracticeShareText(practiceResult, current.prompt, buildQuestionLink(current));
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* user cancelled / clipboard blocked */
    }
  };

  if (error) return <div className="app"><p className="result lose">Error: {error}</p></div>;
  // Wait only for what this view actually needs. The daily additionally blocks
  // on the schedule, since that decides whether the bank is needed at all — a
  // frozen day renders without a single byte of it being fetched.
  const waiting = (mode === 'DAILY' && !scheduleReady) || !bankReady;
  if (waiting) return <div className="app"><p>Loading…</p></div>;

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
      ) : linkedQuestion ? (
        // Deep-linked single question: play it fresh, no filters/deck.
        <>
          <p className="daily-progress">A friend shared this question</p>
          <QuestionRouter question={linkedQuestion} onComplete={setPracticeResult} />
          {practiceResult && (
            <div className="practice-share">
              <button onClick={sharePractice}>{copied ? 'Copied!' : 'Share result'}</button>
              <a className="link-btn" href={import.meta.env.BASE_URL}>
                Play more →
              </a>
            </div>
          )}
        </>
      ) : (
        <>
          {linkMissing && (
            <p className="link-missing">That shared question isn’t available anymore — here’s the practice deck instead.</p>
          )}
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
            {(['ALL', 'LIST', 'CAREER_PATH', 'MATCH', 'SQUAD'] as FormatFilter[]).map((f) => (
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
            <>
              <QuestionRouter question={current} onNext={next} onComplete={setPracticeResult} />
              {practiceResult && (
                <div className="practice-share">
                  <button onClick={sharePractice}>{copied ? 'Copied!' : 'Share result'}</button>
                </div>
              )}
            </>
          ) : (
            <p>No questions for this filter.</p>
          )}
        </>
      )}

      <footer>
        <p>
          Player data from Wikipedia (CC BY-SA). First or last name alone counts; minor typos are
          forgiven.
        </p>
      </footer>
    </div>
  );
}
