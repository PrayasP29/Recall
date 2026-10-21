import { useEffect, useMemo, useState } from 'react'
import {
  applyRevision,
  calendarEvents,
  dueProblems,
  isDue,
  toLocalDay,
  withInitialSchedule,
} from './lib/revisionScheduler.js'
import './App.css'

// ponytail: set SUPPORT_URL to the real support page before release.
// While null the button renders disabled and links nowhere — intentional,
// so we never ship a placeholder URL that looks like a real destination.
const SUPPORT_URL = null

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const pad = (n) => String(n).padStart(2, '0')

const fmtDay = (day) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const label = (rec) => rec.title || rec.problemId

function ProblemLink({ rec }) {
  return (
    <a className="open" href={rec.url} target="_blank" rel="noreferrer">
      Open
    </a>
  )
}

function App() {
  const [problems, setProblems] = useState(null) // null = still loading
  // ponytail: "today" is fixed when the popup opens; reopen it after midnight.
  const [today] = useState(() => toLocalDay(new Date()))
  const [view, setView] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)

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

  const due = useMemo(() => (problems ? dueProblems(problems, today) : []), [problems, today])
  // Earliest upcoming revision — explains an empty queue ("why no buttons?").
  const nextUp = useMemo(() => {
    if (!problems) return null
    const days = Object.values(problems)
      .map((r) => r.nextRevisionAt)
      .filter((d) => d && d > today)
    return days.length ? days.sort()[0] : null
  }, [problems, today])
  const events = useMemo(
    () => (problems ? calendarEvents(problems, view.year, view.month) : {}),
    [problems, view],
  )

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

  function shiftMonth(delta) {
    setSelected(null)
    setView(({ year, month }) => {
      const d = new Date(year, month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  if (!problems) return <div className="app empty-state">Loading…</div>

  const firstWeekday = new Date(view.year, view.month, 1).getDay()
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const monthLabel = new Date(view.year, view.month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
  const selectedEvents = selected ? events[selected] : null

  return (
    <div className="app">
      <header>
        <h1>Recall</h1>
        <span className="subtitle">LeetCode revision tracker</span>
      </header>

      <section>
        <h2>Due today {due.length > 0 && <span className="count">{due.length}</span>}</h2>
        {due.length === 0 ? (
          <p className="empty-state">
            All caught up — nothing due today.
            {nextUp ? ` Next revision: ${fmtDay(nextUp)}.` : ''}
          </p>
        ) : (
          due.map((rec) => (
            <div className="card" key={rec.problemId}>
              <div className="card-top">
                <span className="title">{label(rec)}</span>
                {rec.difficulty && <span className={`diff ${rec.difficulty.toLowerCase()}`}>{rec.difficulty}</span>}
              </div>
              <div className="card-bottom">
                <span className={rec.nextRevisionAt < today ? 'overdue' : 'due'}>
                  {rec.nextRevisionAt < today
                    ? `Overdue — was due ${fmtDay(rec.nextRevisionAt)}`
                    : 'Due today'}
                </span>
                <ProblemLink rec={rec} />
              </div>
              <div className="actions">
                <button type="button" className="btn remembered" disabled={busy} onClick={() => review(rec.problemId, 'remembered')}>
                  Remembered
                </button>
                <button type="button" className="btn forgotten" disabled={busy} onClick={() => review(rec.problemId, 'forgotten')}>
                  Forgotten
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section>
        <div className="month-nav">
          <button type="button" className="btn nav" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            ‹
          </button>
          <h2 className="month-label">{monthLabel}</h2>
          <button type="button" className="btn nav" onClick={() => shiftMonth(1)} aria-label="Next month">
            ›
          </button>
        </div>

        <div className="grid">
          {WEEKDAYS.map((w) => (
            <div className="wd" key={w}>
              {w}
            </div>
          ))}
          {Array.from({ length: firstWeekday }, (_, i) => (
            <div className="cell blank" key={`b${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = `${view.year}-${pad(view.month + 1)}-${pad(i + 1)}`
            const ev = events[day]
            return (
              <button
                type="button"
                key={day}
                className={`cell${selected === day ? ' selected' : ''}${day === today ? ' today' : ''}`}
                onClick={() => setSelected(selected === day ? null : day)}
              >
                <span className="num">{i + 1}</span>
                <span className="dots">
                  {ev?.solved?.length ? <i className="dot solved" /> : null}
                  {ev?.revisions?.length ? <i className="dot revision" /> : null}
                </span>
              </button>
            )
          })}
        </div>

        <div className="legend">
          <span>
            <i className="dot solved" /> First solved
          </span>
          <span>
            <i className="dot revision" /> Revision due
          </span>
        </div>

        {selected ? (
          selectedEvents ? (
            <div className="day-panel">
              <h3>{fmtDay(selected)}</h3>
              {selectedEvents.solved.map((rec) => (
                <div className="row" key={`s-${rec.problemId}`}>
                  <span>
                    {label(rec)} <em>solved</em>
                  </span>
                  <ProblemLink rec={rec} />
                </div>
              ))}
              {selectedEvents.revisions.map((rec) => {
                const due = isDue(rec, today)
                return (
                  <div className="row" key={`r-${rec.problemId}`}>
                    <span>
                      {label(rec)}{' '}
                      <em>
                        {due
                          ? rec.nextRevisionAt < today
                            ? 'revision overdue'
                            : 'revision due today'
                          : 'revision scheduled'}
                      </em>
                    </span>
                    <span className="row-controls">
                      <ProblemLink rec={rec} />
                      {due ? (
                        <>
                          <button
                            type="button"
                            className="btn remembered"
                            disabled={busy}
                            onClick={() => review(rec.problemId, 'remembered')}
                          >
                            Remembered
                          </button>
                          <button
                            type="button"
                            className="btn forgotten"
                            disabled={busy}
                            onClick={() => review(rec.problemId, 'forgotten')}
                          >
                            Forgotten
                          </button>
                        </>
                      ) : null}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="day-panel">
              <h3>{fmtDay(selected)}</h3>
              <p className="empty-state">Nothing recorded for this day.</p>
            </div>
          )
        ) : Object.keys(events).length === 0 ? (
          <p className="empty-state">No solved problems or revisions this month.</p>
        ) : null}
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
