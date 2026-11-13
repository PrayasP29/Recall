import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './NewTabDashboard.css';
import { toLocalDay } from './lib/revisionScheduler.js';
import { normalizeTopics } from './lib/patterns.js';
import { revisionSessionUrl } from './lib/revisionSession.js';
import { historySyncState } from './lib/historySync.js';
import {
  calculateStreak,
  calculateUniqueRevisedCount,
  getCalendarDayActivity,
  isDayActive,
  isProblemRevisedOnDate,
  recordRevision,
  REVISION_ACTIVITY_STORAGE_KEY,
} from './lib/revisionTracking.js';
import { getBrowserAPI, getStorageArea } from './lib/browserApi.js';

// Background motif
import backdropCircles from './assets/backdrop-circles.svg';

const QUOTES = [
  'REPETITION IS THE ONLY SHORTCUT.',
  'SOLVED ONCE IS SEEN. SOLVED TWICE IS KNOWN.',
  'SHOW UP. SOLVE ONE MORE.',
];

const GITHUB_REPO_URL = 'https://github.com/PrayasP29/Recall';
const LEETCODE_BASE_URL = 'https://leetcode.com';
const SUPPORT_URL = 'https://rzp.io/rzp/support-recall';
const EXTENSION_VERSION = 'v1.0.2';

function getIssueDetails(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start + (start.getTimezoneOffset() - date.getTimezoneOffset()) * 60 * 1000;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);
  const isLeap = (date.getFullYear() % 4 === 0 && date.getFullYear() % 100 !== 0) || (date.getFullYear() % 400 === 0);
  const daysInYear = isLeap ? 366 : 365;
  return { dayOfYear, daysInYear };
}

function formatDateStamp(date) {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  return `${weekday} ${day} ${month}`;
}

function getWeekColumns(todayDay) {
  const now = new Date();
  const current = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOfWeek = current.getDay(); // 0 is Sunday, 1 is Monday
  const distanceToMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(current);
  monday.setDate(current.getDate() - distanceToMonday);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dayStr = toLocalDay(d);
    days.push({
      dateObj: d,
      dayStr,
      weekday: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
      dayNum: d.getDate(),
      isToday: dayStr === todayDay,
      isFuture: dayStr > todayDay,
    });
  }
  return days;
}

export default function NewTabDashboard() {
  const api = useMemo(() => getBrowserAPI(), []);
  const storageLocal = useMemo(() => getStorageArea('local'), []);
  const [problems, setProblems] = useState(null); // null = loading
  const [selection, setSelection] = useState([]);
  const [dailySelections, setDailySelections] = useState({});
  const [revisionActivity, setRevisionActivity] = useState([]);
  const [todayDay, setTodayDay] = useState(() => toLocalDay(new Date()));
  const [loadError, setLoadError] = useState(false);
  const [sync, setSync] = useState({ status: 'idle' });
  const [syncFeedback, setSyncFeedback] = useState(null); // 'success' | 'failure' | null
  const [reduceMotion, setReduceMotion] = useState(false);
  const [activePanel, setActivePanel] = useState(null); // 'settings' | 'about' | null
  const [animatingCount, setAnimatingCount] = useState(null);

  const heroBlockRef = useRef(null);

  // Initialize and load stored data
  const loadData = useCallback(() => {
    const currentToday = toLocalDay(new Date());
    setTodayDay(currentToday);

    if (!storageLocal) {
      setProblems({});
      setSelection([]);
      setDailySelections({});
      setRevisionActivity([]);
      return;
    }

    storageLocal.get(['problems', 'dailySelections', 'recall_reduce_motion', REVISION_ACTIVITY_STORAGE_KEY])
      .then((storage) => {
        if (!storage) {
          setProblems({});
          setSelection([]);
          setDailySelections({});
          setRevisionActivity([]);
          return;
        }

        if (storage.recall_reduce_motion !== undefined) {
          setReduceMotion(Boolean(storage.recall_reduce_motion));
        } else {
          const sysPrefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
          setReduceMotion(Boolean(sysPrefersReduced));
        }

        if (Array.isArray(storage[REVISION_ACTIVITY_STORAGE_KEY])) {
          setRevisionActivity(storage[REVISION_ACTIVITY_STORAGE_KEY]);
        }

        const storedProblems = storage.problems ?? {};
        const storedSelections = storage.dailySelections ?? {};
        setDailySelections(storedSelections);

        if (storedSelections[currentToday] !== undefined) {
          setProblems(storedProblems);
          setSelection(storedSelections[currentToday] || []);
          return;
        }

        // If selection is not yet created for today, wait up to 1.5s then request from background
        setTimeout(() => {
          api?.runtime?.sendMessage?.({
            type: 'RECALL_GET_DAILY_SELECTION',
            todayDay: currentToday,
          }).then((res) => {
            if (res?.status === 'ok') {
              setProblems(res.problems ?? {});
              setSelection(res.selection ?? []);
            } else {
              setProblems(storedProblems);
              setSelection([]);
            }
          }).catch(() => {
            setProblems(storedProblems);
            setSelection([]);
          });
        }, 1500);
      })
      .catch((err) => {
        console.error('Recall New Tab storage error:', err);
        setLoadError(true);
        setProblems({});
        setSelection([]);
        setDailySelections({});
        setRevisionActivity([]);
      });
  }, [api, storageLocal]);

  useEffect(() => {
    const currentToday = toLocalDay(new Date());

    if (!storageLocal) {
      // In dev/test preview outside extension
      const fallbackTimer = setTimeout(() => {
        setProblems({});
        setSelection([]);
        setDailySelections({});
        setRevisionActivity([]);
      }, 0);
      return () => clearTimeout(fallbackTimer);
    }

    storageLocal.get(['problems', 'dailySelections', 'recall_reduce_motion', REVISION_ACTIVITY_STORAGE_KEY])
      .then((storage) => {
        if (storage.recall_reduce_motion !== undefined) {
          setReduceMotion(Boolean(storage.recall_reduce_motion));
        } else {
          const sysPrefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
          setReduceMotion(Boolean(sysPrefersReduced));
        }

        if (Array.isArray(storage[REVISION_ACTIVITY_STORAGE_KEY])) {
          setRevisionActivity(storage[REVISION_ACTIVITY_STORAGE_KEY]);
        }

        const storedProblems = storage.problems ?? {};
        const storedSelections = storage.dailySelections ?? {};
        setDailySelections(storedSelections);

        if (storedSelections[currentToday] !== undefined) {
          setProblems(storedProblems);
          setSelection(storedSelections[currentToday] || []);
          return;
        }

        // Wait up to 1.5s before querying background
        setTimeout(() => {
          api?.runtime?.sendMessage?.({
            type: 'RECALL_GET_DAILY_SELECTION',
            todayDay: currentToday,
          }).then((res) => {
            if (res?.status === 'ok') {
              setProblems(res.problems ?? {});
              setSelection(res.selection ?? []);
            } else {
              setProblems(storedProblems);
              setSelection([]);
            }
          }).catch(() => {
            setProblems(storedProblems);
            setSelection([]);
          });
        }, 1500);
      })
      .catch((err) => {
        console.error('Recall New Tab storage error:', err);
        setLoadError(true);
        setProblems({});
        setSelection([]);
        setDailySelections({});
        setRevisionActivity([]);
      });

    // Re-check day and selection on window focus
    const onFocus = () => {
      const nowDay = toLocalDay(new Date());
      setTodayDay((prev) => {
        if (prev !== nowDay) {
          loadData();
          return nowDay;
        }
        return prev;
      });
    };
    window.addEventListener('focus', onFocus);

    // Live storage updates
    const onStorageChange = (changes, area) => {
      if (area !== 'local') return;
      if (changes.problems || changes.dailySelections) {
        loadData();
      }
      if (changes.dailySelections) {
        setDailySelections(changes.dailySelections.newValue || {});
      }
      if (changes[REVISION_ACTIVITY_STORAGE_KEY]) {
        setRevisionActivity(changes[REVISION_ACTIVITY_STORAGE_KEY].newValue || []);
      }
      if (changes.recall_reduce_motion !== undefined) {
        setReduceMotion(Boolean(changes.recall_reduce_motion.newValue));
      }
    };
    api?.storage?.onChanged?.addListener?.(onStorageChange);

    // Sync progress listener
    const onRuntimeMessage = (msg) => {
      if (msg?.type !== 'RECALL_SYNC_PROGRESS') return;
      setSync((s) => (s.status === 'running' ? { ...s, progress: msg } : s));
    };
    api?.runtime?.onMessage?.addListener?.(onRuntimeMessage);

    return () => {
      window.removeEventListener('focus', onFocus);
      api?.storage?.onChanged?.removeListener?.(onStorageChange);
      api?.runtime?.onMessage?.removeListener?.(onRuntimeMessage);
    };
  }, [api, storageLocal, loadData]);

  // Sync action (reusing popup mechanism)
  const triggerSync = async () => {
    if (sync.status === 'running') return;
    setSync({ status: 'running' });
    setSyncFeedback(null);

    try {
      const tabs = await (api?.tabs?.query ? api.tabs.query({ url: 'https://leetcode.com/*' }) : Promise.resolve([]));
      const tab = tabs.find((t) => typeof t.id === 'number');
      if (!tab) {
        setSync({ status: 'error', message: 'Open leetcode.com in a tab first, then retry.' });
        setSyncFeedback('failure');
        return;
      }

      const res = await (api?.tabs?.sendMessage ? api.tabs.sendMessage(tab.id, { type: 'RECALL_SYNC_HISTORY' }) : Promise.reject());
      if (res?.status !== 'complete' && res?.status !== 'partial') {
        setSync({ status: 'error', message: res?.message ?? 'Sync failed. Reload LeetCode and retry.' });
        setSyncFeedback('failure');
        return;
      }

      const nextState = historySyncState(res);
      if (!nextState) {
        setSync({ status: 'error', message: 'Sync failed.' });
        setSyncFeedback('failure');
        return;
      }

      setProblems(nextState.problems);
      setSelection(nextState.selection);
      setSync(res);
      setSyncFeedback('success');
      setTimeout(() => setSyncFeedback(null), 2500);
    } catch {
      setSync({ status: 'error', message: 'Could not reach LeetCode tab.' });
      setSyncFeedback('failure');
    }
  };

  // Toggle reduce motion
  const handleToggleReduceMotion = async () => {
    const nextVal = !reduceMotion;
    setReduceMotion(nextVal);
    try {
      if (storageLocal) { await storageLocal.set({ recall_reduce_motion: nextVal }); }
    } catch (e) {
      console.error('Failed to save reduce-motion setting', e);
    }
  };

  // Date & editorial metadata
  const now = new Date();
  const dateStamp = formatDateStamp(now);
  const weekdayName = now.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
  const dayOfMonth = now.getDate();
  const { dayOfYear, daysInYear } = getIssueDetails(now);
  const heroQuote = QUOTES[dayOfYear % QUOTES.length];

  // Problems metadata & counts
  const totalTracked = useMemo(() => Object.keys(problems ?? {}).length, [problems]);

  // Revision tracking counts
  const revisedCount = useMemo(
    () => calculateUniqueRevisedCount(revisionActivity, problems),
    [revisionActivity, problems]
  );

  const currentStreak = useMemo(
    () => calculateStreak(revisionActivity, todayDay),
    [revisionActivity, todayDay]
  );

  const isTodayActive = useMemo(
    () => isDayActive(revisionActivity, todayDay),
    [revisionActivity, todayDay]
  );

  // Mark a problem as revised today (with idempotent duplicate protection)
  const handleMarkRevised = async (problemId) => {
    if (!problemId) return;
    const { nextActivity, isNew } = recordRevision(revisionActivity, problemId, todayDay);
    if (!isNew) return;
    setRevisionActivity(nextActivity);
    try {
      if (storageLocal) { await storageLocal.set({ [REVISION_ACTIVITY_STORAGE_KEY]: nextActivity }); }
    } catch (err) {
      console.error('Failed to persist revision activity:', err);
    }
  };

  const selectedQuestions = useMemo(() => {
    if (!problems) return [];
    return selection.map((id) => problems[id]).filter(Boolean);
  }, [problems, selection]);

  // Count-up animation for TOTAL TRACKED
  useEffect(() => {
    if (problems === null) return;
    if (reduceMotion || sessionStorage.getItem('recall_tracked_animated')) return;

    sessionStorage.setItem('recall_tracked_animated', 'true');
    const duration = 600;
    const startTime = performance.now();
    const startVal = 0;
    const endVal = totalTracked;
    let frameId;

    const frame = (nowTime) => {
      const elapsed = nowTime - startTime;
      const progress = Math.min(1, elapsed / duration);
      setAnimatingCount(Math.round(startVal + (endVal - startVal) * progress));
      if (progress < 1) {
        frameId = requestAnimationFrame(frame);
      } else {
        setAnimatingCount(null);
      }
    };
    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [totalTracked, problems, reduceMotion]);

  const trackedCountDisplay = animatingCount !== null ? animatingCount : totalTracked;

  // Topic & difficulty statistics
  const { uniqueTopicsCount, difficultyCounts } = useMemo(() => {
    const topicSet = new Set();
    const diffMap = { Easy: 0, Medium: 0, Hard: 0 };
    for (const rec of Object.values(problems ?? {})) {
      const tops = normalizeTopics(rec?.topics);
      tops.forEach((t) => topicSet.add(t));
      if (rec?.difficulty && diffMap[rec.difficulty] !== undefined) {
        diffMap[rec.difficulty] += 1;
      }
    }
    return {
      uniqueTopicsCount: topicSet.size,
      difficultyCounts: diffMap,
    };
  }, [problems]);

  // Activity by day of week (shared source of truth with progress and revision metrics)
  const weekColumns = useMemo(() => {
    const cols = getWeekColumns(todayDay);
    const mergedSelections = {
      ...dailySelections,
      [todayDay]: selection,
    };

    return cols.map((col) => {
      const activity = getCalendarDayActivity({
        dayStr: col.dayStr,
        dailySelections: mergedSelections,
        revisionActivity,
        todayDay,
      });

      return {
        ...col,
        markers: activity.markers,
        completedCount: activity.completedCount,
        hasActivity: activity.markers.length > 0,
      };
    });
  }, [dailySelections, revisionActivity, todayDay, selection]);

  const anyActivityInWeek = weekColumns.some((col) => col.hasActivity);

  // Keyboard navigation & drawer ESC handling
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && activePanel) {
        setActivePanel(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePanel]);

  // Intro text generator based on state
  const introText = useMemo(() => {
    if (loadError) return "Recall couldn't read your data. Your questions are safe. Try again.";
    if (problems && totalTracked === 0) {
      return 'Recall tracks the problems you solve on LeetCode. Get your first Accepted submission, or sync your history.';
    }
    if (selectedQuestions.length === 2) {
      return "Two problems you've solved before. Revisit them today and keep them yours.";
    }
    if (selectedQuestions.length === 1) {
      return 'One problem is waiting for you today. Make it count.';
    }
    return 'None of your solved problems are due for revision today. Come back tomorrow, or solve something new on LeetCode.';
  }, [loadError, problems, totalTracked, selectedQuestions.length]);

  const firstQuestionUrl = selectedQuestions[0]?.url ? revisionSessionUrl(selectedQuestions[0].url) : null;

  return (
    <div className={`newtab-shell ${reduceMotion ? 'reduced-motion' : ''}`}>
      {/* Skip to Main Content */}
      <a href="#today" className="skip-link">
        Skip to Today's Questions
      </a>

      {/* ====================================================================
          SECTION 1 — TODAY'S REVISION (Dark editorial hero, questions in view)
          ==================================================================== */}
      <section
        id="today"
        className="hero-block"
        ref={heroBlockRef}
        aria-label="Today's Revision"
      >
        {/* Background Decorative Motif */}
        <div className="hero-backdrop-motif" aria-hidden="true">
          <img src={backdropCircles} alt="" />
        </div>

        {/* Site Header */}
        <header className="hero-header grid-container">
          {/* Left: Wordmark */}
          <div
            className="wordmark"
            onClick={() => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })}
            role="button"
            tabIndex={0}
            aria-label="Recall - scroll to top"
          >
            RECALL<span className="brand-dot" />
          </div>

          {/* Centre: Nav Anchors */}
          <nav className="header-nav" aria-label="Section navigation">
            <a href="#today" className="nav-link active">
              TODAY
            </a>
            <span className="nav-sep" aria-hidden="true" />
            <a href="#next-move" className="nav-link">
              YOUR MOVE
            </a>
            <span className="nav-sep" aria-hidden="true" />
            <a href="#progress" className="nav-link">
              PROGRESS
            </a>
            <span className="nav-sep" aria-hidden="true" />
            <a href="#activity" className="nav-link">
              ACTIVITY
            </a>
          </nav>

          {/* Right: Date Stamp & Icon Buttons */}
          <div className="header-actions">
            <div className="date-stamp">{dateStamp}</div>

            {/* Sync Feedback Status Badge */}
            {syncFeedback === 'success' && <span className="sync-feedback-badge success">SYNCED</span>}
            {syncFeedback === 'failure' && <span className="sync-feedback-badge failure">SYNC FAILED. RETRY.</span>}

            {/* Sync Circular Button */}
            <button
              type="button"
              className={`circular-btn ${sync.status === 'running' ? 'syncing' : ''}`}
              onClick={triggerSync}
              disabled={sync.status === 'running'}
              title="Sync LeetCode submission history"
              aria-label="Sync LeetCode History"
              aria-busy={sync.status === 'running'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
              </svg>
            </button>

            {/* Settings Circular Button */}
            <button
              type="button"
              className="circular-btn"
              onClick={() => setActivePanel('settings')}
              title="Open Settings"
              aria-label="Open Settings"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
            </button>
          </div>
        </header>

        {/* Section 1 Main Content */}
        <div className="hero-content grid-container">
          {/* Top Info & Stats Row */}
          <div className="hero-stats-band">
            {/* Meta Left */}
            <div className="meta-left">
              <div className="section-label dark">
                <span className="crimson-tick" />
                TODAY'S REVISION
              </div>
              <div className="meta-issue">
                ISSUE {String(dayOfYear).padStart(3, '0')} / {daysInYear}
              </div>
              <div className="meta-count-group">
                <div className="index-circle">
                  {problems === null ? '—' : String(selectedQuestions.length).padStart(2, '0')}
                </div>
                <div className="marks-row" aria-label={`${selectedQuestions.length} questions selected`}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={`mark-dot ${i < selectedQuestions.length ? 'filled' : ''}`}
                      aria-hidden="true"
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* The 3 Discs */}
            <div className="discs-row">
              {/* Disc 1: Today */}
              <div className="editorial-disc variant-paper">
                <span className="disc-top-label">TODAY</span>
                <span className="disc-numeral">{dayOfMonth}</span>
              </div>

              {/* Disc 2: Questions */}
              <div className="editorial-disc variant-crimson">
                <span className="disc-top-label">QUESTIONS</span>
                <span className="disc-numeral">
                  {problems === null ? '—' : loadError ? '×' : selectedQuestions.length}
                </span>
              </div>

              {/* Disc 3: Total Tracked */}
              <div className="editorial-disc variant-ink">
                <span className="disc-top-label">TOTAL TRACKED</span>
                <span className="disc-numeral">
                  {problems === null ? '—' : loadError ? '×' : totalTracked}
                </span>
              </div>
            </div>

            {/* Pull Quote */}
            <div className="hero-pull-quote">
              <div className="quote-text">{heroQuote}</div>
              <div className="quote-arrow" aria-hidden="true">
                ↘
              </div>
            </div>
          </div>

          {/* Daily Revision Questions List (Directly in Main Initial View) */}
          <div className="hero-questions-section">
            <div className="hero-questions-header">
              <span className="section-label dark">
                {problems === null
                  ? "LOADING TODAY'S REVISION…"
                  : `${selectedQuestions.length} OF 2 SELECTED FOR TODAY`}
              </span>
            </div>

            {/* Loading Skeleton */}
            {problems === null && (
              <div className="hero-questions-list" aria-busy="true">
                <div className="hero-question-skeleton">
                  <div className="skeleton-idx">01</div>
                  <div className="skeleton-body">
                    <div className="skeleton-bar pulse" style={{ width: '28%', marginBottom: 8 }} />
                    <div className="skeleton-bar pulse" style={{ width: '65%', height: 32 }} />
                  </div>
                  <div className="skeleton-btn pulse" />
                </div>
                <div className="hero-question-skeleton">
                  <div className="skeleton-idx">02</div>
                  <div className="skeleton-body">
                    <div className="skeleton-bar pulse" style={{ width: '22%', marginBottom: 8 }} />
                    <div className="skeleton-bar pulse" style={{ width: '58%', height: 32 }} />
                  </div>
                  <div className="skeleton-btn pulse" />
                </div>
              </div>
            )}

            {/* Error State */}
            {problems !== null && loadError && (
              <div className="state-panel error-panel dark-state" role="alert">
                <h3 className="state-headline">SOMETHING WENT WRONG.</h3>
                <p className="state-body">
                  Recall couldn't read your data. Your questions are safe. Try again.
                </p>
                <div className="state-actions">
                  <button type="button" className="primary-cta-btn" onClick={loadData}>
                    TRY AGAIN
                  </button>
                  <button
                    type="button"
                    className="cta-secondary-link light-link"
                    onClick={() => setActivePanel('about')}
                  >
                    ABOUT RECALL
                  </button>
                </div>
              </div>
            )}

            {/* Empty State: Zero Stored Questions */}
            {problems !== null && !loadError && totalTracked === 0 && (
              <div className="state-panel dark-state">
                <h3 className="state-headline">START YOUR LIBRARY.</h3>
                <p className="state-body">
                  Recall tracks the problems you solve on LeetCode. Get your first Accepted submission,
                  or sync your history.
                </p>
                <div className="state-actions">
                  <a
                    className="primary-cta-btn"
                    href={LEETCODE_BASE_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    OPEN LEETCODE ↗
                  </a>
                  <button
                    type="button"
                    className="hero-open-btn secondary"
                    onClick={triggerSync}
                    disabled={sync.status === 'running'}
                  >
                    SYNC HISTORY
                  </button>
                </div>
              </div>
            )}

            {/* Empty State: Tracked questions exist, but none eligible today */}
            {problems !== null && !loadError && totalTracked > 0 && selectedQuestions.length === 0 && (
              <div className="state-panel dark-state">
                <h3 className="state-headline">ALL CAUGHT UP.</h3>
                <p className="state-body">
                  None of your solved problems are due for revision today. Come back tomorrow, or
                  solve something new on LeetCode.
                </p>
                <div className="state-actions">
                  <a
                    className="hero-open-btn secondary"
                    href={`${LEETCODE_BASE_URL}/problemset/all/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    OPEN LEETCODE ↗
                  </a>
                </div>
              </div>
            )}

            {/* Selected Questions (Both accessible immediately) */}
            {problems !== null && !loadError && selectedQuestions.length > 0 && (
              <div className="hero-questions-list">
                {selectedQuestions.map((rec, index) => {
                  const href = revisionSessionUrl(rec.url) ?? rec.url;
                  const topicsList = normalizeTopics(rec.topics);
                  const displayTopics = topicsList.slice(0, 3).map((t) => t.toUpperCase()).join(' · ');
                  const remainingTopics = topicsList.length > 3 ? ` +${topicsList.length - 3}` : '';
                  const diff = rec.difficulty || 'Medium';
                  const isRevisedToday = isProblemRevisedOnDate(revisionActivity, rec.problemId, todayDay);

                  return (
                    <div
                      key={rec.problemId}
                      className={`hero-question-row ${isRevisedToday ? 'is-revised' : ''}`}
                    >
                      <div className="hero-q-idx">
                        {String(index + 1).padStart(2, '0')}
                      </div>

                      <div className="hero-q-content">
                        <div className="hero-q-topics">
                          {displayTopics ? `${displayTopics}${remainingTopics}` : 'OTHER'}
                        </div>
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="hero-q-title-link"
                          title="Open problem on LeetCode"
                        >
                          <h2 className="hero-q-title">{rec.title || rec.problemId}</h2>
                        </a>
                        <div className="difficulty-marker">
                          <span
                            className={`diff-dot dark-diff ${diff === 'Hard' ? 'hard-filled' : 'filled'}`}
                          />
                          <span
                            className={`diff-dot dark-diff ${diff === 'Hard' ? 'hard-filled' : diff === 'Medium' ? 'filled' : ''}`}
                          />
                          <span
                            className={`diff-dot dark-diff ${diff === 'Hard' ? 'hard-filled' : ''}`}
                          />
                          <span className={`difficulty-name ${diff === 'Hard' ? 'hard' : ''}`}>
                            {diff.toUpperCase()}
                          </span>
                        </div>
                      </div>

                      <div className="hero-q-action">
                        <div className="hero-action-buttons">
                          <button
                            type="button"
                            className={`hero-revised-btn ${isRevisedToday ? 'completed' : ''}`}
                            onClick={() => handleMarkRevised(rec.problemId)}
                            title={isRevisedToday ? 'Marked as revised today' : 'Mark as revised today'}
                            aria-label={
                              isRevisedToday
                                ? `${rec.title || rec.problemId} marked as revised today`
                                : `Mark ${rec.title || rec.problemId} as revised`
                            }
                          >
                            {isRevisedToday ? (
                              <>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                                REVISED
                              </>
                            ) : (
                              <>
                                <span className="revise-dot" />
                                MARK AS REVISED
                              </>
                            )}
                          </button>

                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className={`hero-open-btn ${index === 0 ? 'primary' : 'secondary'}`}
                          >
                            OPEN ON LEETCODE
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <line x1="7" y1="17" x2="17" y2="7" />
                              <polyline points="7 7 17 7 17 17" />
                            </svg>
                          </a>
                        </div>
                        <span className="hero-open-hint">
                          {isRevisedToday ? 'COMPLETED TODAY' : 'OPENS IN NEW TAB'}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {/* Single selected notice */}
                {selectedQuestions.length === 1 && (
                  <div className="single-selected-notice dark-notice">
                    <span className="crimson-tick" />
                    ONLY ONE QUESTION WAS ELIGIBLE TODAY.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Side navigation anchor discs at bottom edges */}
        <button
          type="button"
          className="hero-edge-anchor left"
          onClick={() => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })}
          title="Scroll to top"
          aria-label="Scroll to top"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="16,4 6,12 16,20" />
          </svg>
        </button>

        <button
          type="button"
          className="hero-edge-anchor right"
          onClick={() => document.getElementById('next-move')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' })}
          title="Scroll to Next Move"
          aria-label="Scroll to Next Move"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="8,4 18,12 8,20" />
          </svg>
        </button>
      </section>

      {/* ====================================================================
          SECTION 2 — YOUR NEXT MOVE (Original large-scale landing-page section)
          ==================================================================== */}
      <section id="next-move" className="landing-next-move-section" aria-label="Your Next Move">
        <div className="grid-container">
          <div className="headline-row">
            <h1 className="headline-h1">
              <span>YOUR</span>
              <span className="headline-connector">NEXT</span>
              <span>MOVE.</span>
            </h1>
          </div>

          <div className="headline-meta-row">
            <div className="meta-left-col">
              <div className="edition-label">EDITION · {weekdayName}</div>
              <blockquote className="motivational-quote-box">
                <span className="quote-bracket">[</span>
                <p className="motivational-quote-text">
                  DEBUG YOUR HABITS BEFORE SOMEONE DEBUGS YOUR <span className="crimson-accent">INTERVIEW.</span>
                </p>
                <span className="quote-bracket">]</span>
              </blockquote>
            </div>

            <div className="intro-cta-box">
              <p className="intro-lead">{introText}</p>

              {firstQuestionUrl ? (
                <a
                  className="primary-cta-btn large-cta"
                  href={firstQuestionUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  START REVISING
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </a>
              ) : (
                <button type="button" className="primary-cta-btn large-cta" disabled>
                  {problems === null ? 'LOADING…' : 'NOTHING TO REVISE'}
                </button>
              )}

              <a
                href="#today"
                className="cta-secondary-link"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById('today')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
                }}
              >
                SEE TODAY'S QUESTIONS ↑
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          SECTION 3 — PROGRESS (Canvas surface, original generous spacing)
          ==================================================================== */}
      <section id="progress" className="progress-section" aria-label="Progress and Library Overview">
        <div className="grid-container">
          <div className="section-header-row" style={{ borderBottomColor: 'var(--text-ink)' }}>
            <div>
              <span className="crimson-tick" />
              <span className="section-label light">YOUR LIBRARY</span>
              <h2 className="section-title">PROGRESS.</h2>
            </div>
          </div>

          <div className="progress-grid">
            {/* Dominant Block (Cols 1-5): TOTAL TRACKED */}
            <div className="stat-block-dominant">
              <div>
                <span className="section-label light">TOTAL TRACKED</span>
                <div className="dominant-numeral">{trackedCountDisplay}</div>
                {uniqueTopicsCount > 0 && (
                  <span className="section-label light">
                    ACROSS {uniqueTopicsCount} {uniqueTopicsCount === 1 ? 'TOPIC' : 'TOPICS'}
                  </span>
                )}
              </div>

              {/* Difficulty Split Bar & Legend */}
              <div>
                <div className="difficulty-split-bar">
                  <div
                    className="diff-segment easy"
                    style={{
                      width: totalTracked ? `${(difficultyCounts.Easy / totalTracked) * 100}%` : '0%',
                    }}
                    title={`Easy: ${difficultyCounts.Easy}`}
                  />
                  <div
                    className="diff-segment medium"
                    style={{
                      width: totalTracked ? `${(difficultyCounts.Medium / totalTracked) * 100}%` : '0%',
                    }}
                    title={`Medium: ${difficultyCounts.Medium}`}
                  />
                  <div
                    className="diff-segment hard"
                    style={{
                      width: totalTracked ? `${(difficultyCounts.Hard / totalTracked) * 100}%` : '0%',
                    }}
                    title={`Hard: ${difficultyCounts.Hard}`}
                  />
                </div>
                <div className="difficulty-split-legend">
                  <span>EASY · {difficultyCounts.Easy}</span>
                  <span>MEDIUM · {difficultyCounts.Medium}</span>
                  <span style={{ color: 'var(--crimson)' }}>HARD · {difficultyCounts.Hard}</span>
                </div>
              </div>
            </div>

            {/* Secondary Blocks (Cols 6-12 in a row: 2 cards) */}
            <div className="stat-blocks-secondary">
              {/* Block 2: Revised */}
              <div className="stat-block-card" aria-label={`Revised: ${revisedCount} distinct problems`}>
                <div>
                  <span className="section-label light">REVISED</span>
                  <div className="stat-card-numeral active-numeral">{revisedCount}</div>
                  <span className="stat-card-sublabel">
                    {revisedCount === 1 ? 'DISTINCT PROBLEM' : 'DISTINCT PROBLEMS'}
                  </span>
                </div>
                <span className="stat-card-status">MARKED REVISED</span>
              </div>

              {/* Block 3: Streak */}
              <div className="stat-block-card" aria-label={`Streak: ${currentStreak} days`}>
                <div>
                  <span className="section-label light">STREAK</span>
                  <div className="stat-card-numeral active-numeral">
                    {currentStreak} <span className="stat-unit">DAYS</span>
                  </div>
                  <span className="stat-card-sublabel">
                    {currentStreak > 0
                      ? isTodayActive
                        ? 'CONSECUTIVE DAYS'
                        : 'EXTEND TODAY'
                      : 'START TODAY'}
                  </span>
                </div>
                <span className="stat-card-status">DAILY STREAK</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          SECTION 4 — THIS WEEK (Paper surface, original generous spacing)
          ==================================================================== */}
      <section id="activity" className="weekly-activity-section" aria-label="Weekly Activity">
        <div className="grid-container">
          <div className="section-header-row">
            <div>
              <span className="crimson-tick" />
              <span className="section-label light">ACTIVITY</span>
              <h2 className="section-title">THIS WEEK.</h2>
            </div>
          </div>

          <div className="week-strip-container">
            {weekColumns.map((col) => (
              <div
                key={col.dayStr}
                className={`day-column ${col.isToday ? 'is-today' : ''} ${col.isFuture ? 'is-future' : ''}`}
                tabIndex={col.completedCount > 0 ? 0 : undefined}
                title={col.completedCount > 0 ? `${col.completedCount} REVISED` : undefined}
              >
                <div className="day-col-header">
                  <span className="day-col-name">{col.weekday}</span>
                  <span className="day-col-date">{col.dayNum}</span>
                </div>

                <div className="day-marker-area">
                  {col.markers.map((marker) => (
                    <span
                      key={marker.problemId}
                      className={`activity-square ${marker.status === 'pending' ? 'outlined' : ''}`}
                      title={marker.status === 'completed' ? 'Revised' : 'Pending revision'}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="activity-caption-row">
            {anyActivityInWeek
              ? 'SHOWING REVISIONS RECORDED BY RECALL'
              : 'ACTIVITY RECORDED AS YOU REVISE'}
          </div>
        </div>
      </section>

      {/* ====================================================================
          SECTION 5 — SITE FOOTER (on bg-ink, rounded top corners)
          ==================================================================== */}
      <footer className="site-footer">
        <div className="grid-container">
          <div className="footer-top-row">
            <div className="footer-brand">
              <div
                className="wordmark"
                onClick={() => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })}
                role="button"
                tabIndex={0}
                aria-label="Recall - scroll to top"
              >
                RECALL<span className="brand-dot" />
              </div>
              <div className="footer-tagline">YOUR DAILY CODING REVISION.</div>
            </div>

            <div className="footer-links-group">
              {GITHUB_REPO_URL && (
                <a
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="footer-link"
                >
                  GITHUB
                </a>
              )}
              <a
                href={LEETCODE_BASE_URL}
                target="_blank"
                rel="noreferrer"
                className="footer-link"
              >
                LEETCODE
              </a>
              <button
                type="button"
                className="footer-link"
                onClick={() => setActivePanel('about')}
              >
                ABOUT RECALL
              </button>
              <a
                href={SUPPORT_URL}
                target="_blank"
                rel="noreferrer"
                className="footer-link"
              >
                SUPPORT RECALL
              </a>
            </div>
          </div>

          <div className="footer-bottom-row">
            <span>© RECALL</span>
            <span>{EXTENSION_VERSION}</span>
          </div>
        </div>
      </footer>

      {/* ====================================================================
          SIDE PANELS (Settings / About Drawers)
          ==================================================================== */}
      {activePanel && (
        <div
          className="drawer-backdrop"
          onClick={() => setActivePanel(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="drawer-panel"
            onClick={(e) => e.stopPropagation()}
            tabIndex={-1}
          >
            <div className="drawer-header">
              <div>
                <h2 className="drawer-title">
                  {activePanel === 'settings' ? 'SETTINGS' : 'ABOUT RECALL'}
                </h2>
                <p className="drawer-subtext">
                  {activePanel === 'settings'
                    ? 'Recall New Tab uses the same data as the popup.'
                    : 'Your quiet, editorial coding revision companion.'}
                </p>
              </div>
              <button
                type="button"
                className="drawer-close-btn"
                onClick={() => setActivePanel(null)}
                aria-label="Close panel"
              >
                ✕
              </button>
            </div>

            <div className="drawer-content">
              {activePanel === 'settings' ? (
                <>
                  {/* Sync Row */}
                  <div className="drawer-setting-row">
                    <div className="drawer-row-info">
                      <span className="drawer-row-label">SYNC HISTORY</span>
                      <span className="drawer-row-desc">
                        Import your latest accepted submissions from LeetCode.
                      </span>
                    </div>
                    <button
                      type="button"
                      className="hero-open-btn secondary"
                      onClick={triggerSync}
                      disabled={sync.status === 'running'}
                    >
                      {sync.status === 'running' ? 'SYNCING…' : 'SYNC NOW'}
                    </button>
                  </div>

                  {/* Reduce Motion Row */}
                  <div className="drawer-setting-row">
                    <div className="drawer-row-info">
                      <span className="drawer-row-label">REDUCE MOTION</span>
                      <span className="drawer-row-desc">
                        Disable transitions and count-up effects.
                      </span>
                    </div>
                    <div
                      className={`toggle-switch ${reduceMotion ? 'active' : ''}`}
                      onClick={handleToggleReduceMotion}
                      role="switch"
                      aria-checked={reduceMotion}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          e.preventDefault();
                          handleToggleReduceMotion();
                        }
                      }}
                    >
                      <div className="toggle-knob" />
                    </div>
                  </div>

                  {/* About Recall Link */}
                  <div className="drawer-setting-row">
                    <div className="drawer-row-info">
                      <span className="drawer-row-label">ABOUT RECALL</span>
                      <span className="drawer-row-desc">
                        Learn about the revision schedule and local storage.
                      </span>
                    </div>
                    <button
                      type="button"
                      className="cta-secondary-link"
                      onClick={() => setActivePanel('about')}
                    >
                      VIEW →
                    </button>
                  </div>
                </>
              ) : (
                /* About Panel Content (<= 90 words) */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontSize: 14, lineHeight: 1.6 }}>
                  <p>
                    Recall tracks the problems you solve on LeetCode and schedules them for spaced revision.
                  </p>
                  <p>
                    All problem records, tags, and revision dates are stored privately and locally in your browser.
                    No data is ever sent to external servers.
                  </p>
                  <p>
                    Each day, Recall selects up to two previously solved problems for you to revisit.
                    Open LeetCode in a tab and tap Sync to import your latest accepted submissions.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
