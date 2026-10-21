import { applyRevision, withInitialSchedule } from './lib/revisionScheduler.js'
import { assignImportSchedules } from './lib/importScheduler.js'
import { mergeImported } from './lib/importer.js'
import {
  isAcceptedEvent,
  isHistoryMerge,
  isReviewRequest,
} from './lib/messageValidation.js'
import { enqueueOperation } from './lib/operationQueue.js'
import { normalizeProblemUrl, upsertProblem } from './lib/tracker.js'

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

async function saveProblems(problems) {
  console.info('[Recall background] storage write started')
  await storageArea().set({ problems })
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender?.id !== chrome.runtime.id) return
  console.info('[Recall background] message received', msg?.type ?? 'unknown')

  if (msg?.type === 'RECALL_RECORD_ACCEPTED') {
    const event = msg.event
    if (!isAcceptedEvent(event)) return reject(sendResponse)
    return respond(sendResponse, async () => {
      const problems = await loadProblems()
      const slug = event.problemId
      const next = {
        ...problems,
        [slug]: upsertProblem(problems[slug], {
          ...event,
          url: normalizeProblemUrl(slug),
        }),
      }
      await saveProblems(next)
      return { problems: next }
    })
  }

  if (msg?.type === 'RECALL_MERGE_HISTORY') {
    if (!isHistoryMerge(msg)) return reject(sendResponse)
    return respond(sendResponse, async () => {
      const { problems, stats } = mergeImported(await loadProblems(), msg.questions)
      const merged = assignImportSchedules(problems, msg.todayDay)
      await saveProblems(merged)
      return {
        importStatus: msg.importStatus,
        totalNum: msg.totalNum,
        stats,
        problems: merged,
      }
    })
  }

  if (msg?.type === 'RECALL_REVIEW_PROBLEM') {
    if (!isReviewRequest(msg)) return reject(sendResponse)
    return respond(sendResponse, async () => {
      const problems = await loadProblems()
      const record = problems[msg.problemId]
      if (!record) throw new Error('Problem is no longer stored.')
      const updated = applyRevision(record, msg.result)
      if (updated !== record) {
        problems[msg.problemId] = updated
        await saveProblems(problems)
      }
      return { problems }
    })
  }

  if (msg?.type === 'RECALL_MIGRATE_PROBLEMS') {
    return respond(sendResponse, async () => {
      const problems = await loadProblems()
      const migrated = Object.fromEntries(
        Object.entries(problems).map(([id, record]) => [id, withInitialSchedule(record)]),
      )
      if (Object.entries(migrated).some(([id, record]) => record !== problems[id])) {
        await saveProblems(migrated)
      }
      return { problems: migrated }
    })
  }
})
