// History importer — pure logic plus an injected fetch/storage orchestration.
// No DOM, no chrome.* here, so every branch is unit-testable with node:test.
import { assignImportSchedules } from './importScheduler.js'
import { normalizeTopics } from './patterns.js'
import { normalizeProblemUrl } from './tracker.js'
import { toLocalDay } from './revisionScheduler.js'

export const PAGE_SIZE = 50
export const MAX_RETRIES = 2
export const REQUEST_DELAY_MS = 300
export const MAX_PAGES = 1000 // hard stop; ~50k problems

const DIFFICULTIES = new Set(['Easy', 'Medium', 'Hard'])
const SLUG_RE = /^[a-z0-9-]+$/

export const ERROR_MESSAGES = {
  auth: 'Log in to leetcode.com in a browser tab, then retry.',
  busy: 'A sync is already running.',
  network: 'Could not reach LeetCode. Check your connection and retry.',
  http: 'LeetCode rejected the request. Try again later.',
  invalid: 'LeetCode returned an unexpected response. Try again later.',
  storage: 'Could not save imported problems. Nothing was changed.',
  unknown: 'Sync failed. Reload the LeetCode tab and retry.',
}

export class ImportError extends Error {
  constructor(code, { retryable = false } = {}) {
    super(code)
    this.name = 'ImportError'
    this.code = code
    this.retryable = retryable
  }
}

// Parse one GraphQL response. A null data block means logged out/expired —
// never an empty list. HTTP 429/5xx are retryable; other failures are not.
export function parseSolvedPage(httpStatus, json) {
  if (httpStatus === 401 || httpStatus === 403) throw new ImportError('auth')
  if (httpStatus === 429 || httpStatus >= 500) throw new ImportError('http', { retryable: true })
  if (httpStatus < 200 || httpStatus >= 300) throw new ImportError('http')
  const block = json?.data?.userProgressQuestionList
  if (!block) throw new ImportError('auth')
  if (!Number.isInteger(block.totalNum) || block.totalNum < 0) throw new ImportError('invalid')
  if (!Array.isArray(block.questions)) throw new ImportError('invalid')
  return { totalNum: block.totalNum, questions: block.questions }
}

// Merge by slug. Existing records keep every field except null title/difficulty
// (backfilled only). New records get null dates — no invented history.
export function mergeImported(problems, questions) {
  const next = { ...(problems ?? {}) }
  const stats = { discovered: 0, added: 0, matched: 0, skipped: 0 }
  const seen = new Set()
  for (const q of Array.isArray(questions) ? questions : []) {
    const slug = typeof q?.titleSlug === 'string' ? q.titleSlug.trim() : ''
    if (!SLUG_RE.test(slug) || seen.has(slug)) {
      stats.skipped++
      continue
    }
    seen.add(slug)
    stats.discovered++
    const title = typeof q.title === 'string' && q.title ? q.title : null
    const difficulty = DIFFICULTIES.has(q.difficulty) ? q.difficulty : null
    const topics = normalizeTopics(q.topicTags)
    const existing = next[slug]
    if (existing) {
      stats.matched++
      // Backfill only: a null title/difficulty or an empty topic list (failed,
      // logged-out, or absent retrieval) never overwrites what we already have.
      const backfillTopics = !normalizeTopics(existing.topics).length && topics.length
      if ((existing.title == null && title) || (existing.difficulty == null && difficulty) || backfillTopics) {
        next[slug] = {
          ...existing,
          title: existing.title ?? title,
          difficulty: existing.difficulty ?? difficulty,
          ...(backfillTopics ? { topics } : {}),
        }
      }
      continue
    }
    stats.added++
    next[slug] = {
      problemId: slug,
      title,
      url: normalizeProblemUrl(slug),
      difficulty,
      topics,
      // lastSubmittedAt is NOT a verified accepted-solve date — store nothing.
      firstSolvedAt: null,
      lastAcceptedAt: null,
      revisionHistory: [],
      nextRevisionAt: null,
      imported: true, // only new records enter the import scheduling policy
    }
  }
  return { problems: next, stats }
}

async function fetchPageWithRetry(fetchPage, skip, limit, sleep) {
  let last
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchPage(skip, limit)
    } catch (err) {
      last = err
      if (!err?.retryable) break
      if (attempt < MAX_RETRIES) await sleep(1000 * (attempt + 1))
    }
  }
  throw last
}

// Orchestrates pagination + merge + scheduling. Injected side effects make
// auth/partial/storage failures testable without a browser.
export async function syncHistory({
  fetchPage,
  loadProblems,
  saveProblems,
  todayDay = toLocalDay(new Date()),
  onProgress,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const questions = []
  const seen = new Set()
  let totalNum = null
  let page = 0
  let partial = false

  while (true) {
    let res
    try {
      res = await fetchPageWithRetry(fetchPage, page * PAGE_SIZE, PAGE_SIZE, sleep)
    } catch (err) {
      const code = err?.code && ERROR_MESSAGES[err.code] ? err.code : 'network'
      return { status: 'error', code, message: ERROR_MESSAGES[code] }
    }

    if (totalNum == null) totalNum = res.totalNum
    let fresh = 0
    for (const q of res.questions) {
      const slug = typeof q?.titleSlug === 'string' ? q.titleSlug.trim() : ''
      if (!slug || seen.has(slug)) continue
      seen.add(slug)
      questions.push(q)
      fresh++
    }
    page++
    onProgress?.({ page, total: totalNum, collected: questions.length })

    if (questions.length >= totalNum) break
    if (fresh === 0 || page >= MAX_PAGES) {
      partial = true // duplicate-only page or runaway count — stop, report honestly
      break
    }
    await sleep(REQUEST_DELAY_MS)
  }

  let stored
  try {
    stored = await loadProblems()
  } catch {
    return { status: 'error', code: 'storage', message: ERROR_MESSAGES.storage }
  }
  const { problems, stats } = mergeImported(stored, questions)
  const merged = assignImportSchedules(problems, todayDay)
  try {
    await saveProblems(merged)
  } catch {
    return { status: 'error', code: 'storage', message: ERROR_MESSAGES.storage }
  }

  return {
    status: partial ? 'partial' : 'complete',
    totalNum,
    stats,
    problems: merged,
  }
}
