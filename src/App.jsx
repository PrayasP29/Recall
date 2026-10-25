import { useEffect, useMemo, useState } from 'react'
import { toLocalDay } from './lib/revisionScheduler.js'
import './App.css'
import { primaryTopic } from './lib/patterns.js'
import { revisionSessionUrl } from './lib/revisionSession.js'
import { historySyncState } from './lib/historySync.js'
import logo from './assets/logo.png'

// ponytail: set SUPPORT_URL to the real support page before release.
// While null the button renders disabled and links nowhere — intentional,
// so we never ship a placeholder URL that looks like a real destination.
const SUPPORT_URL = null

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

function ProblemLink({ rec, revision }) {
  const href = revision ? revisionSessionUrl(rec.url) : rec.url
  return (
    <a className="open" href={href ?? rec.url} target="_blank" rel="noreferrer">
      Open
    </a>
  )
}

// One problem card for today's persisted selection.
function ProblemCard({ rec }) {
  return (
    <div className="card">
      <div className="card-top">
        <span className="title">{label(rec)}</span>
        {rec.difficulty && (
          <span className={`diff ${rec.difficulty.toLowerCase()}`}>{rec.difficulty}</span>
        )}
      </div>
      <div className="card-bottom">
        <span className="due">{primaryTopic(rec) ?? 'Other'}</span>
        <ProblemLink rec={rec} revision />
      </div>
    </div>
  )
}

function App() {
  const [problems, setProblems] = useState(null) // null = still loading
  const [selection, setSelection] = useState([])
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
    const todayDay = toLocalDay(new Date())
    chrome.runtime.sendMessage({ type: 'RECALL_MIGRATE_PROBLEMS', todayDay })
      .then((response) => {
        if (response?.status === 'ok') {
          setProblems(response.problems)
          setSelection(response.selection ?? [])
          if (response.migrationIssues?.length) {
            setSync({
              status: 'error',
              message: `${response.migrationIssues.length} stored record${response.migrationIssues.length === 1 ? '' : 's'} need manual schedule recovery.`,
            })
          }
        } else {
          setProblems({})
          setSync({ status: 'error', message: response?.message ?? 'Could not load stored problems.' })
        }
      })
      .catch(() => {
        setProblems({})
        setSync({ status: 'error', message: 'Could not load stored problems.' })
      })
  }, [])

  const focus = useMemo(
    () => selection.map((id) => problems?.[id]).filter(Boolean),
    [problems, selection],
  )

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
      const nextState = historySyncState(res)
      if (!nextState) {
        setSync({
          status: 'error',
          message: 'Sync failed. Reload the LeetCode tab and retry.',
        })
        return
      }
      setProblems(nextState.problems)
      setSelection(nextState.selection)
      setSync(res)
    } catch {
      setSync({
        status: 'error',
        message: 'Could not reach the LeetCode tab. Reload it and retry.',
      })
    }
  }

  if (!problems) return <div className="app empty-state">Loading…</div>

  const total = focus.length
  return (
    <div className="app">
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
          <span className="day-label">Today</span>
        </div>

        {total === 0 ? (
          <p className="empty-state">
            {Object.keys(problems).length ? 'No eligible questions today.' : 'No solved questions yet.'}
          </p>
        ) : (
          <>
            {focus.length > 0 && (
              <div className="topic-group">
                <h2 className="topic-heading focus">
                  Today's review
                  <span className="count">
                    {' '}· {focus.length} {focus.length === 1 ? 'question' : 'questions'}
                  </span>
                </h2>
                {focus.map((rec) => (
                  <ProblemCard
                    key={rec.problemId}
                    rec={rec}
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
