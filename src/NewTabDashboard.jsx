import { useEffect, useMemo, useRef, useState } from 'react';
import './NewTabDashboard.css';
import { toLocalDay } from './lib/revisionScheduler.js';
import { normalizeTopics } from './lib/patterns.js';
import { revisionSessionUrl } from './lib/revisionSession.js';
import { historySyncState } from './lib/historySync.js';
import NodeSphere from './components/NodeSphere.jsx';

// Assets
import backdropCircles from './assets/backdrop-circles.svg';

const QUOTES = [
  'REPETITION IS THE ONLY SHORTCUT.',
  'SOLVED ONCE IS SEEN. SOLVED TWICE IS KNOWN.',
  'SHOW UP. SOLVE ONE MORE.',
];

const GITHUB_REPO_URL = 'https://github.com/PrayasP29/Recall';
const LEETCODE_BASE_URL = 'https://leetcode.com';
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
  const [problems, setProblems] = useState(null); // null = loading
  const [selection, setSelection] = useState([]);
  const [todayDay, setTodayDay] = useState(() => toLocalDay(new Date()));
  const [loadError, setLoadError] = useState(false);
  const [sync, setSync] = useState({ status: 'idle' });
  const [syncFeedback, setSyncFeedback] = useState(null); // 'success' | 'failure' | null
  const [reduceMotion, setReduceMotion] = useState(false);
  const [activePanel, setActivePanel] = useState(null); // 'settings' | 'about' | null
  const [animatingCount, setAnimatingCount] = useState(null);

  const heroBlockRef = useRef(null);

  // Initialize and load stored data
  const loadData = () => {
    const currentToday = toLocalDay(new Date());
    setTodayDay(currentToday);

    chrome?.storage?.local?.get(['problems', 'dailySelections', 'recall_reduce_motion'])
      .then((storage) => {
        if (!storage) {
          setProblems({});
          setSelection([]);
          return;
        }

        if (storage.recall_reduce_motion !== undefined) {
          setReduceMotion(Boolean(storage.recall_reduce_motion));
        } else {
          const sysPrefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
          setReduceMotion(Boolean(sysPrefersReduced));
        }

        const storedProblems = storage.problems ?? {};
        const storedSelections = storage.dailySelections ?? {};

        if (storedSelections[currentToday] !== undefined) {
          setProblems(storedProblems);
          setSelection(storedSelections[currentToday] || []);
          return;
        }

        // If selection is not yet created for today, wait up to 1.5s then request from background
        setTimeout(() => {
          chrome.runtime?.sendMessage({
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
      });
  };

  useEffect(() => {
    const currentToday = toLocalDay(new Date());

    if (!chrome?.storage?.local) {
      // In dev/test preview outside extension
      const fallbackTimer = setTimeout(() => {
        setProblems({});
        setSelection([]);
      }, 0);
      return () => clearTimeout(fallbackTimer);
    }

    chrome.storage.local.get(['problems', 'dailySelections', 'recall_reduce_motion'])
      .then((storage) => {
        if (storage.recall_reduce_motion !== undefined) {
          setReduceMotion(Boolean(storage.recall_reduce_motion));
        } else {
          const sysPrefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
          setReduceMotion(Boolean(sysPrefersReduced));
        }

        const storedProblems = storage.problems ?? {};
        const storedSelections = storage.dailySelections ?? {};

        if (storedSelections[currentToday] !== undefined) {
          setProblems(storedProblems);
          setSelection(storedSelections[currentToday] || []);
          return;
        }

        // Wait up to 1.5s before querying background
        setTimeout(() => {
          chrome.runtime.sendMessage({
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
      if (changes.recall_reduce_motion !== undefined) {
        setReduceMotion(Boolean(changes.recall_reduce_motion.newValue));
      }
    };
    chrome.storage?.onChanged?.addListener(onStorageChange);

    // Sync progress listener
    const onRuntimeMessage = (msg) => {
      if (msg?.type !== 'RECALL_SYNC_PROGRESS') return;
      setSync((s) => (s.status === 'running' ? { ...s, progress: msg } : s));
    };
    chrome.runtime?.onMessage?.addListener(onRuntimeMessage);

    return () => {
      window.removeEventListener('focus', onFocus);
      chrome.storage?.onChanged?.removeListener(onStorageChange);
      chrome.runtime?.onMessage?.removeListener(onRuntimeMessage);
    };
  }, []);

  // Sync action (reusing popup mechanism)
  const triggerSync = async () => {
    if (sync.status === 'running') return;
    setSync({ status: 'running' });
    setSyncFeedback(null);

    try {
      const tabs = await chrome.tabs.query({ url: 'https://leetcode.com/*' });
      const tab = tabs.find((t) => typeof t.id === 'number');
      if (!tab) {
        setSync({ status: 'error', message: 'Open leetcode.com in a tab first, then retry.' });
        setSyncFeedback('failure');
        return;
      }

      const res = await chrome.tabs.sendMessage(tab.id, { type: 'RECALL_SYNC_HISTORY' });
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
      await chrome.storage?.local?.set({ recall_reduce_motion: nextVal });
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

  // Activity by day of week
  const weekColumns = useMemo(() => {
    const cols = getWeekColumns(todayDay);
    const solvesByDay = {};
    for (const rec of Object.values(problems ?? {})) {
      const dateStr = rec?.firstSolvedAt ? toLocalDay(new Date(rec.firstSolvedAt)) : null;
      if (dateStr) {
        solvesByDay[dateStr] = (solvesByDay[dateStr] || 0) + 1;
      }
    }

    return cols.map((col) => ({
      ...col,
      solveCount: solvesByDay[col.dayStr] || 0,
      hasRecordedSolves: Object.keys(solvesByDay).length > 0,
    }));
  }, [problems, todayDay]);

  const anyRecordedSolvesInWeek = weekColumns.some((col) => col.solveCount > 0);

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
          1. HERO BLOCK (Dark bg-ink, curved bottom edge + crimson line)
          ==================================================================== */}
      <section
        className="hero-block"
        ref={heroBlockRef}
        aria-label="Editorial Hero"
      >
        {/* Background Decorative Motif */}
        <div className="hero-backdrop-motif" aria-hidden="true">
          <img src={backdropCircles} alt="" />
        </div>

        {/* Ambient Crimson Glow behind stack */}
        <div className="hero-crimson-glow" aria-hidden="true" />

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
            <a href="#today" className="nav-link">
              TODAY
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

        {/* Hero Compact Grid */}
        <div className="hero-content grid-container">
          {/* Left: Cols 1-4: Meta and 3 Discs beneath */}
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

            {/* Discs in a row beneath meta */}
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
          </div>

          {/* Centre: Cols 5-8: Node Sphere */}
          <div className="hero-sphere-center">
            <NodeSphere
              selectedCount={problems === null ? 0 : selectedQuestions.length}
              reduceMotion={reduceMotion}
              heroRef={heroBlockRef}
            />
          </div>

          {/* Right: Cols 9-12: Pull Quote */}
          <div className="hero-pull-quote">
            <div className="quote-text">{heroQuote}</div>
            <div className="quote-arrow" aria-hidden="true">
              ↘
            </div>
          </div>
        </div>

        {/* Edge Navigation Anchor Discs */}
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
          onClick={() => document.getElementById('today')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' })}
          title="Scroll to Today's Revision"
          aria-label="Scroll to Today's Revision"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="8,4 18,12 8,20" />
          </svg>
        </button>
      </section>

      {/* ====================================================================
          2. HEADLINE BAND (on paper surface) — Hybrid compact row with CTA
          ==================================================================== */}
      <section className="headline-band" aria-label="Hero Headline and Call to Action">
        <div className="grid-container headline-grid">
          {/* Cols 1-8: Headline */}
          <div className="headline-col">
            <h1 className="headline-h1">
              <span>YOUR</span>
              <span className="headline-connector">NEXT</span>
              <span>MOVE.</span>
            </h1>
          </div>

          {/* Cols 9-12: Intro + CTA bottom-aligned to headline baseline */}
          <div className="headline-cta-col">
            <p className="intro-lead">{introText}</p>

            <div className="cta-action-group">
              {firstQuestionUrl ? (
                <a
                  className="primary-cta-btn"
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
                <button type="button" className="primary-cta-btn" disabled>
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
                SEE TODAY'S QUESTIONS ↓
              </a>
            </div>
          </div>

          {/* 28px tall strip under headline hairline */}
          <div className="headline-edition-strip">
            <span className="edition-label">EDITION · {weekdayName}</span>
          </div>
        </div>
      </section>

      {/* ====================================================================
          3. DAILY REVISION SECTION (on paper)
          ==================================================================== */}
      <main id="today" className="daily-revision-section">
        <div className="grid-container">
          <div className="section-header-row">
            <div>
              <span className="crimson-tick" />
              <span className="section-label light">DAILY REVISION</span>
              <h2 className="section-title">
                <span className="section-title-connector">TODAY'S</span> REVISION
              </h2>
            </div>
            <div className="section-header-meta">
              {problems === null
                ? "LOADING TODAY'S REVISION…"
                : `${selectedQuestions.length} OF 2 SELECTED`}
            </div>
          </div>

          <div className="revision-entries-list">
            {/* Loading State */}
            {problems === null && (
              <>
                <div className="skeleton-row" aria-busy="true">
                  <div className="entry-index-col">01</div>
                  <div className="entry-content-col">
                    <div className="skeleton-bar pulse" style={{ width: '30%', marginBottom: 12 }} />
                    <div className="skeleton-bar pulse" style={{ width: '80%', height: 40 }} />
                  </div>
                  <div className="entry-action-col">
                    <div className="skeleton-bar pulse" style={{ width: 140, height: 48 }} />
                  </div>
                </div>
                <div className="skeleton-row" aria-busy="true">
                  <div className="entry-index-col">02</div>
                  <div className="entry-content-col">
                    <div className="skeleton-bar pulse" style={{ width: '25%', marginBottom: 12 }} />
                    <div className="skeleton-bar pulse" style={{ width: '70%', height: 40 }} />
                  </div>
                  <div className="entry-action-col">
                    <div className="skeleton-bar pulse" style={{ width: 140, height: 48 }} />
                  </div>
                </div>
              </>
            )}

            {/* Error State */}
            {problems !== null && loadError && (
              <div className="state-panel error-panel" role="alert">
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
                    className="cta-secondary-link"
                    onClick={() => setActivePanel('about')}
                  >
                    ABOUT RECALL
                  </button>
                </div>
              </div>
            )}

            {/* Empty State: Zero Stored Questions */}
            {problems !== null && !loadError && totalTracked === 0 && (
              <div className="state-panel">
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
                    className="entry-open-btn secondary"
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
              <div className="state-panel">
                <h3 className="state-headline">ALL CAUGHT UP.</h3>
                <p className="state-body">
                  None of your solved problems are due for revision today. Come back tomorrow, or
                  solve something new on LeetCode.
                </p>
                <div className="state-actions">
                  <a
                    className="entry-open-btn secondary"
                    href={`${LEETCODE_BASE_URL}/problemset/all/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    OPEN LEETCODE ↗
                  </a>
                </div>
              </div>
            )}

            {/* Active Questions (1 or 2 entries) */}
            {problems !== null && !loadError && selectedQuestions.length > 0 && (
              <>
                {selectedQuestions.map((rec, index) => {
                  const href = revisionSessionUrl(rec.url) ?? rec.url;
                  const topicsList = normalizeTopics(rec.topics);
                  const displayTopics = topicsList.slice(0, 3).map((t) => t.toUpperCase()).join(' · ');
                  const remainingTopics = topicsList.length > 3 ? ` +${topicsList.length - 3}` : '';
                  const diff = rec.difficulty || 'Medium';

                  return (
                    <a
                      key={rec.problemId}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="revision-entry-row"
                      aria-label={`${index + 1}. ${rec.title || rec.problemId}. Topics: ${topicsList.join(', ')}. Difficulty: ${diff}. Opens LeetCode in a new tab.`}
                    >
                      <div className="entry-index-col">
                        {String(index + 1).padStart(2, '0')}
                      </div>

                      <div className="entry-content-col">
                        <div className="entry-topics-line">
                          {displayTopics ? `${displayTopics}${remainingTopics}` : 'OTHER'}
                        </div>
                        <h3 className="entry-title">{rec.title || rec.problemId}</h3>
                        <div className="difficulty-marker">
                          <span
                            className={`diff-dot ${diff === 'Hard' ? 'hard-filled' : 'filled'}`}
                          />
                          <span
                            className={`diff-dot ${diff === 'Hard' ? 'hard-filled' : diff === 'Medium' ? 'filled' : ''}`}
                          />
                          <span
                            className={`diff-dot ${diff === 'Hard' ? 'hard-filled' : ''}`}
                          />
                          <span className={`difficulty-name ${diff === 'Hard' ? 'hard' : ''}`}>
                            {diff.toUpperCase()}
                          </span>
                        </div>
                      </div>

                      <div className="entry-action-col">
                        <span className={`entry-open-btn ${index === 0 ? 'primary' : 'secondary'}`}>
                          OPEN ON LEETCODE
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="7" y1="17" x2="17" y2="7" />
                            <polyline points="7 7 17 7 17 17" />
                          </svg>
                        </span>
                        <span className="entry-open-hint">OPENS IN NEW TAB</span>
                      </div>
                    </a>
                  );
                })}

                {/* Quiet notice row when only 1 question is eligible */}
                {selectedQuestions.length === 1 && (
                  <div className="single-selected-notice">
                    <span className="crimson-tick" />
                    ONLY ONE QUESTION WAS ELIGIBLE TODAY.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {/* ====================================================================
          4. PROGRESS SECTION (on canvas surface)
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

            {/* Secondary Blocks (Cols 6-12 in a row) */}
            <div className="stat-blocks-secondary">
              {/* Block 2: Revised */}
              <div className="stat-block-card" aria-label="Revised: not available yet">
                <div>
                  <span className="section-label light">REVISED</span>
                  <div className="stat-card-numeral">—</div>
                </div>
                <span className="coming-soon-tag">COMING SOON</span>
              </div>

              {/* Block 3: Remaining */}
              <div className="stat-block-card" aria-label="Remaining: not available yet">
                <div>
                  <span className="section-label light">REMAINING</span>
                  <div className="stat-card-numeral">—</div>
                </div>
                <span className="coming-soon-tag">COMING SOON</span>
              </div>

              {/* Block 4: Streak */}
              <div className="stat-block-card" aria-label="Streak: not available yet">
                <div>
                  <span className="section-label light">STREAK</span>
                  <div className="stat-card-numeral">— DAYS</div>
                </div>
                <span className="coming-soon-tag">COMING SOON</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          5. WEEKLY ACTIVITY SECTION (on paper)
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
                tabIndex={col.solveCount > 0 ? 0 : undefined}
                title={col.solveCount > 0 ? `${col.solveCount} SOLVED` : undefined}
              >
                <div className="day-col-header">
                  <span className="day-col-name">{col.weekday}</span>
                  <span className="day-col-date">{col.dayNum}</span>
                </div>

                <div className="day-marker-area">
                  {/* Solves recorded on this day */}
                  {Array.from({ length: Math.min(8, col.solveCount) }).map((_, i) => (
                    <span key={i} className="activity-square" />
                  ))}

                  {/* Today's selected question count markers */}
                  {col.isToday &&
                    Array.from({ length: selectedQuestions.length }).map((_, i) => (
                      <span key={`sel-${i}`} className="activity-square outlined" title="Selected today" />
                    ))}
                </div>
              </div>
            ))}
          </div>

          <div className="activity-caption-row">
            {anyRecordedSolvesInWeek
              ? 'SHOWING SOLVES RECORDED BY RECALL'
              : 'ACTIVITY HISTORY COMING SOON'}
          </div>
        </div>
      </section>

      {/* ====================================================================
          6. SITE FOOTER (on bg-ink, rounded top corners matching hero)
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
            </div>
          </div>

          <div className="footer-bottom-row">
            <span>© RECALL</span>
            <span>{EXTENSION_VERSION}</span>
          </div>
        </div>
      </footer>

      {/* ====================================================================
          7. SIDE PANELS (Settings / About Drawers)
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
                      className="entry-open-btn secondary"
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
                        Disable parallax, transitions and count-up effects.
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
                /* About Panel Content (<= 90 words per §13) */
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
