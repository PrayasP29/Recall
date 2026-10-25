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

const queue = { current: Promise.resolve() }

console.info(
  '[Recall background] service worker loaded',
  `storage=${typeof globalThis.chrome?.storage?.local === 'object' ? 'available' : 'unavailable'}`,
)

function storageArea() {
  const api = globalThis.chrome?.storage?.local
  if (!api || typeof api.get !== 'function' || typeof api.set !== 'function') {
    throw new Error('Chrome storage API unavailable in the Recall service worker.')
  }
  return api
}

async function loadProblems() {
  console.info('[Recall background] storage read started')
  const result = await storageArea().get('problems')
  console.info('[Recall background] storage read completed')
  return result.problems ?? {}
}

async function loadState() {
  const result = await storageArea().get(['problems', 'dailySelections'])
  return { problems: result.problems ?? {}, dailySelections: result.dailySelections ?? {} }
}

async function saveState(problems, dailySelections) {
  console.info('[Recall background] storage write started')
  await storageArea().set({ problems, dailySelections })
  console.info('[Recall background] storage write completed')
  return problems
}

async function saveProblems(problems) {
  const { dailySelections } = await loadState()
  return saveState(problems, dailySelections)
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender?.id !== chrome.runtime.id) return
  console.info('[Recall background] message received', msg?.type ?? 'unknown')

  if (msg?.type === 'RECALL_RECORD_ACCEPTED') {
    const event = msg.event
    if (!isAcceptedEvent(event)) return reject(sendResponse)
    return respond(sendResponse, async () => {
      const problems = await loadProblems()
      const slug = event.problemId
      const next = recordAccepted(problems, {
        ...event,
        url: normalizeProblemUrl(slug),
      })
      await saveProblems(next)
      return { problems: next }
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
