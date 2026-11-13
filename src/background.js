import { assignImportSchedules } from './lib/importScheduler.js'
import { mergeImported } from './lib/importer.js'
import {
  ensureDailySelection,
  initializeEligibility,
} from './lib/dailySelection.js'
import {
  isAcceptedEvent,
  isDailySelectionRequest,
  isHistoryMerge,
} from './lib/messageValidation.js'
import { enqueueOperation } from './lib/operationQueue.js'
import { normalizeProblemUrl, recordAccepted } from './lib/tracker.js'
import { toLocalDay } from './lib/revisionScheduler.js'
import { recordAcceptedRevision } from './lib/revisionTracking.js'
import { getStorageArea } from './lib/browserApi.js'
import {
  getSessionShownInMemory,
  setSessionShownInMemory,
  hasSessionShown,
  markSessionShown,
  resetSessionState,
  shouldInterceptTab,
  isRecallUrl,
} from './lib/sessionManager.js'

const queue = { current: Promise.resolve() }

const api = globalThis.browser ?? globalThis.chrome

console.info(
  '[Recall background] background coordinator loaded',
  `storage=${typeof api?.storage?.local === 'object' ? 'available' : 'unavailable'}`,
)

function storageArea() {
  const local = getStorageArea('local')
  if (!local || typeof local.get !== 'function' || typeof local.set !== 'function') {
    throw new Error('Storage API unavailable in the Recall background script.')
  }
  return local
}

// ---------------------------------------------------------------------------
// ONCE-PER-SESSION NEW TAB INTERCEPTION WITH COMPREHENSIVE DEBUG LOGGING
// ---------------------------------------------------------------------------
let isNavigating = false

function sessionLog(message, details = null) {
  if (details !== null && details !== undefined) {
    console.info(`[Recall session] ${message}`, details)
  } else {
    console.info(`[Recall session] ${message}`)
  }
}

async function maybeInterceptTab(tab, triggerEvent = 'unknown') {
  if (!tab || typeof tab.id !== 'number') return

  const tabId = tab.id
  const initialUrl = tab.url || ''
  const pendingUrl = tab.pendingUrl || ''

  sessionLog(`Tab event [${triggerEvent}] received for tab #${tabId}`, {
    tabId,
    initialUrl,
    pendingUrl,
  })

  // 1. Fast synchronous in-memory check
  if (getSessionShownInMemory()) {
    sessionLog(`Subsequent tab ignored: Recall already shown in this browser session (in-memory latch)`, {
      tabId,
    })
    return
  }

  // 2. Concurrency lock: another tab is currently being redirected
  if (isNavigating) {
    sessionLog(`Subsequent tab ignored: another tab is currently in active navigation to Recall`, {
      tabId,
    })
    return
  }

  // 3. Persistent session storage check (survives service worker suspensions)
  const sessionStorage = getStorageArea('session')
  const shown = await hasSessionShown(sessionStorage)
  sessionLog(`Session flag inspection for tab #${tabId}`, {
    tabId,
    shownInStorage: shown,
    shownInMemory: getSessionShownInMemory(),
  })

  if (shown) {
    setSessionShownInMemory(true)
    sessionLog(`Subsequent tab ignored: Recall already shown in this browser session (session storage)`, {
      tabId,
    })
    return
  }

  if (!api?.tabs) {
    sessionLog(`Tabs API unavailable; skipping tab #${tabId}`)
    return
  }

  // 4. Duplicate check: is Recall already open in any existing tab in any window?
  let isRecallAlreadyOpen = false
  try {
    const existing = await api.tabs.query({})
    if (Array.isArray(existing)) {
      isRecallAlreadyOpen = existing.some((t) => {
        const u = t.url || t.pendingUrl || ''
        return isRecallUrl(u)
      })
    }
  } catch (err) {
    sessionLog(`Warning: failed to query tabs for duplicate check`, err)
  }

  if (isRecallAlreadyOpen) {
    sessionLog(`Subsequent tab ignored: Recall is already open in another tab. Marking session shown to prevent future opens.`, {
      tabId,
    })
    setSessionShownInMemory(true)
    await markSessionShown(sessionStorage)
    return
  }

  // 5. Interception eligibility check
  const shouldIntercept = shouldInterceptTab({
    url: initialUrl,
    pendingUrl,
    hasShownInSession: shown,
    isNavigating,
    isRecallAlreadyOpen,
  })

  sessionLog(`Interception decision for tab #${tabId}`, {
    tabId,
    shouldIntercept,
    initialUrl,
    pendingUrl,
    hasShownInSession: shown,
    isNavigating,
    isRecallAlreadyOpen,
  })

  if (!shouldIntercept) {
    sessionLog(`Tab #${tabId} ignored: URL is not a recognized native new tab target`)
    return
  }

  // 6. SYNCHRONOUSLY claim navigation lock and mark session shown BEFORE calling tabs.update
  // This guarantees that any subsequent tab creation occurring in the next millisecond
  // will immediately see sessionShown=true and be ignored without race conditions.
  isNavigating = true
  setSessionShownInMemory(true)
  await markSessionShown(sessionStorage)

  try {
    const targetUrl = api.runtime.getURL('newtab.html')
    sessionLog(`Navigating tab #${tabId} to Recall: ${targetUrl}`)
    await api.tabs.update(tabId, { url: targetUrl })
    sessionLog(`SUCCESS: Tab #${tabId} opened Recall New Tab`)
  } catch (err) {
    console.warn(`[Recall session] Failed to redirect tab #${tabId}`, err)
  } finally {
    isNavigating = false
  }
}

if (api?.tabs?.onCreated) {
  api.tabs.onCreated.addListener((tab) => {
    maybeInterceptTab(tab, 'tabs.onCreated')
  })
}

if (api?.tabs?.onUpdated) {
  api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only inspect if URL changed and is not already a Recall page
    if (changeInfo.url && !isRecallUrl(changeInfo.url)) {
      maybeInterceptTab({ ...tab, id: tabId, url: changeInfo.url }, 'tabs.onUpdated')
    }
  })
}

if (api?.runtime?.onStartup) {
  api.runtime.onStartup.addListener(async () => {
    sessionLog('Browser startup event received. Clearing in-memory session latch.')
    setSessionShownInMemory(false)
    const sessionStorage = getStorageArea('session')
    await resetSessionState(sessionStorage)
  })
}

if (api?.runtime?.onInstalled) {
  api.runtime.onInstalled.addListener((details) => {
    sessionLog(`Extension installed/updated event (${details?.reason})`)
  })
}

async function loadState() {
  const result = await storageArea().get(['problems', 'dailySelections', 'revisionActivity'])
  return {
    problems: result.problems ?? {},
    dailySelections: result.dailySelections ?? {},
    revisionActivity: Array.isArray(result.revisionActivity) ? result.revisionActivity : [],
  }
}

async function saveState(problems, dailySelections, revisionActivity = null) {
  console.info('[Recall background] storage write started')
  const payload = { problems, dailySelections }
  if (revisionActivity !== null) {
    payload.revisionActivity = revisionActivity
  }
  await storageArea().set(payload)
  console.info('[Recall background] storage write completed')
  return problems
}

function respond(sendResponse, operation) {
  enqueueOperation(queue, operation)
    .then((value) => sendResponse({ status: 'ok', ...value }))
    .catch((error) => {
      console.error('[Recall background] storage operation failed', error?.message ?? error)
      sendResponse({ status: 'error', message: error?.message ?? 'Storage operation failed.' })
    })
  return true
}

function reject(sendResponse, message = 'Invalid message payload.') {
  sendResponse({ status: 'error', message })
  return true
}

api?.runtime?.onMessage?.addListener((msg, sender, sendResponse) => {
  if (sender?.id !== api.runtime.id) return
  console.info('[Recall background] message received', msg?.type ?? 'unknown')

  if (msg?.type === 'RECALL_RECORD_ACCEPTED') {
    const event = msg.event
    if (!isAcceptedEvent(event)) return reject(sendResponse)
    return respond(sendResponse, async () => {
      const state = await loadState()
      const problems = state.problems
      const slug = event.problemId
      const next = recordAccepted(problems, {
        ...event,
        url: normalizeProblemUrl(slug),
      })

      const todayDay = toLocalDay(new Date(event.at ?? Date.now()))
      const { nextActivity } = recordAcceptedRevision({
        problems,
        dailySelections: state.dailySelections,
        revisionActivity: state.revisionActivity ?? [],
        problemId: slug,
        date: todayDay,
        timestamp: event.at,
      })

      await saveState(next, state.dailySelections, nextActivity)
      return { problems: next, revisionActivity: nextActivity }
    })
  }

  if (msg?.type === 'RECALL_MERGE_HISTORY') {
    if (!isHistoryMerge(msg)) return reject(sendResponse)
    return respond(sendResponse, async () => {
      const state = await loadState()
      const { problems, stats } = mergeImported(state.problems, msg.questions)
      const imported = assignImportSchedules(problems, msg.todayDay)
      const { problems: merged, migrationIssues } = initializeEligibility(imported, msg.todayDay)
      const { selection, dailySelections } = ensureDailySelection(
        merged,
        state.dailySelections,
        msg.todayDay,
      )
      await saveState(merged, dailySelections)
      return {
        importStatus: msg.importStatus,
        totalNum: msg.totalNum,
        stats,
        problems: merged,
        selection,
        migrationIssues,
      }
    })
  }

  if (msg?.type === 'RECALL_MIGRATE_PROBLEMS' || msg?.type === 'RECALL_GET_DAILY_SELECTION') {
    if (!isDailySelectionRequest(msg)) return reject(sendResponse)
    return respond(sendResponse, async () => {
      const { problems, dailySelections } = await loadState()
      const { problems: migrated, migrationIssues } = initializeEligibility(problems, msg.todayDay)
      const { selection, dailySelections: nextSelections } = ensureDailySelection(
        migrated,
        dailySelections,
        msg.todayDay,
      )
      if (
        JSON.stringify(migrated) !== JSON.stringify(problems) ||
        JSON.stringify(nextSelections) !== JSON.stringify(dailySelections)
      ) {
        await saveState(migrated, nextSelections)
      }
      return { problems: migrated, selection, migrationIssues }
    })
  }
})
