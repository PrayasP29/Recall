import { useEffect, useMemo, useState } from 'react'
import {
  addDays,
  applyRevision,
  isDue,
  toLocalDay,
  withInitialSchedule,
} from './lib/revisionScheduler.js'
import './App.css'
import { dayPlan } from './lib/patterns.js'
import bgImage from './assets/bg.jpeg'
import logo from './assets/logo.png'

// ponytail: set SUPPORT_URL to the real support page before release.
// While null the button renders disabled and links nowhere — intentional,
// so we never ship a placeholder URL that looks like a real destination.
const SUPPORT_URL = null

const fmtDay = (day) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

const label = (rec) => rec.title || rec.problemId

function syncText(sync) {
  if (sync.status === 'idle') return ''
  if (sync.status === 'running') {
    const p = sync.progress
    return p ? `Syncing page ${p.page} (${p.collected}/${p.total})...` : 'Syncing...'
  }
  if (sync.status === 'error') return sync.message
  const s = sync.stats ?? { discovered: 0, added: 0, matched: 0, skipped: 0 }
  const parts = [`${s.added} added`, `${s.matched} already tracked`]
  if (s.skipped) parts.push(`${s.skipped} skipped`)
  const head = sync.status === 'complete' ? 'Complete' : 'Partial import'
  return `${head} - ${s.discovered} of ${sync.totalNum} found: ${parts.join(', ')}.`
}

function ProblemLink({ rec }) {
  return (
    <a className="open" href={rec.url} target="_blank" rel="noreferrer">
      Open
    </a>
  )
}

// One problem card, reused by every section. `due` gates the review actions;
// future-day cards render Open-only.
function ProblemCard({ rec, due, busy, today, onReview }) {
  return (
    <div className="card">
      <div className="card-top">
        <span className="title">{label(rec)}</span>
        {rec.difficulty && (
          <span className={`diff ${rec.difficulty.toLowerCase()}`}>{rec.difficulty}</span>
        )}
      </div>
      <div className="card-bottom">
        <span className={due && rec.nextRevisionAt < today ? 'overdue' : 'due'}>
          {due
            ? rec.nextRevisionAt < today
              ? `Overdue — was due ${fmtDay(rec.nextRevisionAt)}`
              : 'Due today'
            : `Scheduled ${fmtDay(rec.nextRevisionAt)}`}
        </span>
        <ProblemLink rec={rec} />
      </div>
      {due ? (
        <div className="actions">
          <button type="button" className="btn remembered" disabled={busy} onClick={() => onReview(rec.problemId, 'remembered')}>
            Remembered
          </button>
          <button type="button" className="btn forgotten" disabled={busy} onClick={() => onReview(rec.problemId, 'forgotten')}>
            Forgotten
          </button>
        </div>
      ) : null}
    </div>
  )
}

function App() {
  const [problems, setProblems] = useState(null) // null = still loading
  // ponytail: "today" is fixed when the popup opens; reopen it after midnight.
  const [today] = useState(() => toLocalDay(new Date()))
  const [selected, setSelected] = useState(() => toLocalDay(new Date()))
  const [busy, setBusy] = useState(false)
  const [sync, setSync] = useState({ status: 'idle' })

  useEffect(() => {
    const onMessage = (msg) => {
      if (msg?.type !== 'RECALL_SYNC_PROGRESS') return
      setSync((s) => (s.status === 'running' ? { ...s, progress: msg } : s))
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [])

  useEffect(() => {
    chrome.storage.local.get('problems').then(({ problems: stored = {} } = {}) => {
      const migrated = Object.fromEntries(
        Object.entries(stored).map(([id, rec]) => [id, withInitialSchedule(rec)]),
      )
      // Persist one-time migration of legacy records (null nextRevisionAt).
      if (Object.entries(migrated).some(([id, rec]) => rec !== stored[id])) {
        chrome.storage.local.set({ problems: migrated })
      }
      setProblems(migrated)
    })
  }, [])

  // Problems shown for the selected day. On/before today this is the due +
  // overdue queue (isDue); on a future day it is exactly what is scheduled
  // that day — the same nextRevisionAt match calendarEvents uses internally,
  // but not month-scoped so day navigation can cross month boundaries.
  // Past/today: one focus pattern (≤3) + overdue/other safety sections,
  // derived purely from the day's due+overdue list. Future: exactly what is
  // scheduled that day, Open-only — the heading is "Scheduled", not a pattern.
  const plan = useMemo(() => {
    if (!problems) return { focusTopic: null, focus: [], overdue: [], other: [] }
    const all = Object.values(problems)
    if (selected > today) {
      return {
        focusTopic: 'Scheduled',
        focus: all.filter((r) => r.nextRevisionAt === selected),
        overdue: [],
        other: [],
      }
    }
    return dayPlan(all, selected)
  }, [problems, selected, today])

  // Earliest upcoming revision — explains an empty day ("why no buttons?").
  const nextUp = useMemo(() => {
    if (!problems) return null
    const days = Object.values(problems)
      .map((r) => r.nextRevisionAt)
      .filter((d) => d && d > today)
    return days.length ? days.sort()[0] : null
  }, [problems, today])

  async function review(id, result) {
    if (busy) return
    const updated = applyRevision(problems[id], result)
    if (updated === problems[id]) return // duplicate attempt guard
    const next = { ...problems, [id]: updated }
    setProblems(next) // instant UI update: the card leaves the queue
    setBusy(true)
    try {
      await chrome.storage.local.set({ problems: next })
    } finally {
      setBusy(false)
    }
  }

  function shiftDay(delta) {
    setSelected((d) => addDays(d, delta))
  }

  async function syncHistory() {
    if (sync.status === 'running') return
    setSync({ status: 'running' })
    try {
      const tabs = await chrome.tabs.query({ url: 'https://leetcode.com/*' })
      const tab = tabs.find((t) => typeof t.id === 'number')
      if (!tab) {
        setSync({ status: 'error', message: 'Open leetcode.com in a tab first, then retry.' })
        return
      }
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'RECALL_SYNC_HISTORY' })
      if (res?.status !== 'complete' && res?.status !== 'partial') {
        setSync({
          status: 'error',
          message: res?.message ?? 'Sync failed. Reload the LeetCode tab and retry.',
        })
        return
      }
      if (res.problems) setProblems(res.problems)
      setSync(res)
    } catch {
      setSync({
        status: 'error',
        message: 'Could not reach the LeetCode tab. Reload it and retry.',
      })
    }
  }

  if (!problems) return <div className="app empty-state">Loading…</div>

  const total = plan.focus.length + plan.overdue.length + plan.other.length

  return (
    <div className="app" style={{ '--bg-image': `url(${bgImage})` }}>
      <header>
        <img className="brand-mark" src={logo} alt="" />
        <div className="brand-text">
          <h1>Recall</h1>
          <span className="subtitle">LeetCode revision tracker</span>
        </div>
      </header>

      <section className="sync">
        <button
          type="button"
          className="btn"
          onClick={syncHistory}
          disabled={sync.status === 'running'}
          title="Click to sync your LeetCode history"
        >
          {sync.status === 'running' ? 'Syncing…' : 'Sync LeetCode History'}
        </button>
        <span className={`sync-status${sync.status === 'error' ? ' error' : ''}`}>{syncText(sync)}</span>
      </section>

      <section>
        <div className="day-nav">
          <button type="button" className="btn nav" onClick={() => shiftDay(-1)} aria-label="Previous day">
            ‹
          </button>
          <span className="day-label">{selected === today ? 'Today' : fmtDay(selected)}</span>
          <button type="button" className="btn nav" onClick={() => shiftDay(1)} aria-label="Next day">
            ›
          </button>
        </div>

        {total === 0 ? (
          <p className="empty-state">
            {selected === today ? 'Nothing due today.' : 'No revisions scheduled this day.'}
            {nextUp ? ` Next revision: ${fmtDay(nextUp)}.` : ''}
          </p>
        ) : (
          <>
            {plan.focus.length > 0 && (
              <div className="topic-group">
                <h2 className="topic-heading focus">
                  {plan.focusTopic || 'Other'}
                  <span className="count">
                    {' '}· {plan.focus.length}
                    {plan.focusTopic !== 'Scheduled'
                      ? ` ${plan.focus.length === 1 ? 'question' : 'questions'}`
                      : ''}
                  </span>
                </h2>
                {plan.focus.map((rec) => (
                  <ProblemCard
                    key={rec.problemId}
                    rec={rec}
                    due={isDue(rec, today)}
                    busy={busy}
                    today={today}
                    onReview={review}
                  />
                ))}
              </div>
            )}
            {plan.overdue.length > 0 && (
              <div className="topic-group">
                <h2 className="topic-heading secondary">Overdue</h2>
                {plan.overdue.map((rec) => (
                  <ProblemCard
                    key={rec.problemId}
                    rec={rec}
                    due={isDue(rec, today)}
                    busy={busy}
                    today={today}
                    onReview={review}
                  />
                ))}
              </div>
            )}
            {plan.other.length > 0 && (
              <div className="topic-group">
                <h2 className="topic-heading secondary">Other</h2>
                {plan.other.map((rec) => (
                  <ProblemCard
                    key={rec.problemId}
                    rec={rec}
                    due={isDue(rec, today)}
                    busy={busy}
                    today={today}
                    onReview={review}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <footer>
        {SUPPORT_URL ? (
          <a className="open support" href={SUPPORT_URL} target="_blank" rel="noreferrer">
            Support Recall
          </a>
        ) : (
          <button type="button" className="open support" disabled title="Support URL not configured yet">
            Support Recall
          </button>
        )}
      </footer>
    </div>
  )
}

export default App
