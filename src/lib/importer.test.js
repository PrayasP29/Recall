import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays } from './revisionScheduler.js'
import {
  ImportError,
  MAX_RETRIES,
  mergeImported,
  parseSolvedPage,
  syncHistory,
} from './importer.js'

const TODAY = '2026-10-21'
const TOMORROW = addDays(TODAY, 1)

const q = (slug, over = {}) => ({
  titleSlug: slug,
  title: slug,
  difficulty: 'Medium',
  ...over,
})

const page = (questions, totalNum) => ({ totalNum, questions })

const stubPages = (pages) => {
  const calls = []
  let i = 0
  const fn = async (skip, limit) => {
    calls.push({ skip, limit })
    if (i >= pages.length) throw new ImportError('invalid')
    return pages[i++]
  }
  fn.calls = calls
  return fn
}

const noopSleep = async () => {}

// --- response validation --------------------------------------------------

test('parseSolvedPage accepts a valid page', () => {
  const res = parseSolvedPage(200, {
    data: { userProgressQuestionList: page([q('two-sum')], 1) },
  })
  assert.equal(res.totalNum, 1)
  assert.equal(res.questions.length, 1)
})

test('null data is an auth failure, never an empty list', () => {
  assert.throws(
    () => parseSolvedPage(200, { data: { userProgressQuestionList: null } }),
    (err) => err instanceof ImportError && err.code === 'auth',
  )
})

test('auth and HTTP failures map to error codes', () => {
  for (const status of [401, 403]) {
    assert.throws(() => parseSolvedPage(status, {}), (err) => err.code === 'auth')
  }
  for (const status of [429, 500, 503]) {
    assert.throws(
      () => parseSolvedPage(status, {}),
      (err) => err.code === 'http' && err.retryable === true,
    )
  }
  assert.throws(() => parseSolvedPage(400, {}), (err) => err.code === 'http' && !err.retryable)
})

test('malformed payloads are rejected', () => {
  const block = (over) => ({ data: { userProgressQuestionList: { totalNum: 1, questions: [], ...over } } })
  assert.throws(() => parseSolvedPage(200, block({ totalNum: 'many' })), (e) => e.code === 'invalid')
  assert.throws(() => parseSolvedPage(200, block({ totalNum: -1 })), (e) => e.code === 'invalid')
  assert.throws(() => parseSolvedPage(200, block({ questions: null })), (e) => e.code === 'invalid')
  assert.throws(() => parseSolvedPage(200, null), (e) => e.code === 'auth')
})

// --- merge ----------------------------------------------------------------

test('new imports get null dates, normalized url, and imported flag', () => {
  const { problems, stats } = mergeImported({}, [q('two-sum', { title: 'Two Sum', difficulty: 'Easy' })])
  assert.deepEqual(stats, { discovered: 1, added: 1, matched: 0, skipped: 0 })
  const rec = problems['two-sum']
  assert.equal(rec.problemId, 'two-sum')
  assert.equal(rec.title, 'Two Sum')
  assert.equal(rec.difficulty, 'Easy')
  assert.equal(rec.url, 'https://leetcode.com/problems/two-sum/')
  assert.equal(rec.firstSolvedAt, null)
  assert.equal(rec.lastAcceptedAt, null)
  assert.deepEqual(rec.revisionHistory, [])
  assert.equal(rec.imported, true)
})

test('duplicate slugs are collapsed and counted as skipped', () => {
  const { problems, stats } = mergeImported({}, [q('a'), q('a'), q('b')])
  assert.deepEqual(Object.keys(problems).sort(), ['a', 'b'])
  assert.equal(stats.added, 2)
  assert.equal(stats.skipped, 1)
})

test('invalid slugs and fields are skipped, not invented', () => {
  const { problems, stats } = mergeImported({}, [
    q('two sum'),
    q(''),
    q('ok', { title: 42, difficulty: 'Extreme' }),
  ])
  assert.deepEqual(Object.keys(problems), ['ok'])
  assert.equal(problems.ok.title, null)
  assert.equal(problems.ok.difficulty, null)
  assert.equal(stats.skipped, 2)
})

test('existing records keep dates, history, schedule, and are only metadata-backfilled', () => {
  const existing = {
    'two-sum': {
      problemId: 'two-sum',
      title: null,
      url: 'https://leetcode.com/problems/two-sum/',
      difficulty: null,
      firstSolvedAt: '2026-09-01T10:00:00.000Z',
      lastAcceptedAt: '2026-09-02T10:00:00.000Z',
      revisionHistory: [{ reviewedAt: '2026-09-03T10:00:00.000Z', result: 'remembered', nextRevisionAt: '2026-09-06' }],
      nextRevisionAt: '2026-09-06',
    },
  }
  const { problems, stats } = mergeImported(existing, [
    q('two-sum', { title: 'Two Sum', difficulty: 'Easy' }),
  ])
  assert.equal(stats.matched, 1)
  assert.equal(stats.added, 0)
  assert.equal(problems['two-sum'].title, 'Two Sum')
  assert.equal(problems['two-sum'].difficulty, 'Easy')
  assert.equal(problems['two-sum'].firstSolvedAt, existing['two-sum'].firstSolvedAt)
  assert.equal(problems['two-sum'].lastAcceptedAt, existing['two-sum'].lastAcceptedAt)
  assert.equal(problems['two-sum'].nextRevisionAt, '2026-09-06')
  assert.deepEqual(problems['two-sum'].revisionHistory, existing['two-sum'].revisionHistory)
  assert.equal(problems['two-sum'].imported, undefined)
})

test('existing non-null metadata is never overwritten', () => {
  const existing = {
    'two-sum': {
      problemId: 'two-sum',
      title: 'Custom Title',
      difficulty: 'Hard',
      url: 'https://leetcode.com/problems/two-sum/',
      firstSolvedAt: '2026-09-01T10:00:00.000Z',
      lastAcceptedAt: '2026-09-01T10:00:00.000Z',
      revisionHistory: [],
      nextRevisionAt: '2026-09-06',
    },
  }
  const { problems } = mergeImported(existing, [q('two-sum', { title: 'Two Sum', difficulty: 'Easy' })])
  assert.equal(problems['two-sum'].title, 'Custom Title')
  assert.equal(problems['two-sum'].difficulty, 'Hard')
})

test('merging the same page twice is idempotent', () => {
  const first = mergeImported({}, [q('a'), q('b')])
  const second = mergeImported(first.problems, [q('a'), q('b')])
  assert.deepEqual(second.problems, first.problems)
  assert.deepEqual(second.stats, { discovered: 2, added: 0, matched: 2, skipped: 0 })
})

// --- sync orchestration ---------------------------------------------------

test('paginates until totalNum is reached and schedules imports at 3/day', async () => {
  const slugs = Array.from({ length: 120 }, (_, i) => `p${String(i).padStart(3, '0')}`)
  const fetchPage = stubPages([
    page(slugs.slice(0, 50).map((s) => q(s)), 120),
    page(slugs.slice(50, 100).map((s) => q(s)), 120),
    page(slugs.slice(100).map((s) => q(s)), 120),
  ])
  let saved = null
  const progress = []
  const result = await syncHistory({
    fetchPage,
    loadProblems: async () => ({}),
    saveProblems: async (p) => {
      saved = p
    },
    todayDay: TODAY,
    sleep: noopSleep,
    onProgress: (p) => progress.push(p),
  })

  assert.deepEqual(fetchPage.calls.map((c) => c.skip), [0, 50, 100])
  assert.equal(result.status, 'complete')
  assert.equal(result.totalNum, 120)
  assert.deepEqual(result.stats, { discovered: 120, added: 120, matched: 0, skipped: 0 })
  assert.equal(progress.length, 3)
  assert.deepEqual(progress.at(-1), { page: 3, total: 120, collected: 120 })
  assert.deepEqual(saved, result.problems)

  const perDay = {}
  for (const rec of Object.values(saved)) {
    assert.equal(rec.firstSolvedAt, null)
    assert.ok(rec.nextRevisionAt)
    perDay[rec.nextRevisionAt] = (perDay[rec.nextRevisionAt] ?? 0) + 1
  }
  for (const [day, count] of Object.entries(perDay)) {
    assert.ok(count <= 3, `${day} has ${count}`)
  }
  assert.ok(perDay[TOMORROW] >= 1)
  assert.ok(Object.keys(perDay).every((d) => d > TODAY))
})

test('auth failure aborts without touching storage', async () => {
  let saved = false
  const result = await syncHistory({
    fetchPage: async () => {
      throw new ImportError('auth')
    },
    loadProblems: async () => ({}),
    saveProblems: async () => {
      saved = true
    },
    todayDay: TODAY,
    sleep: noopSleep,
  })
  assert.equal(result.status, 'error')
  assert.equal(result.code, 'auth')
  assert.equal(saved, false)
})

test('malformed response is an error, not an empty import', async () => {
  const result = await syncHistory({
    fetchPage: async () => {
      throw new ImportError('invalid')
    },
    loadProblems: async () => ({}),
    saveProblems: async () => {},
    todayDay: TODAY,
    sleep: noopSleep,
  })
  assert.equal(result.status, 'error')
  assert.equal(result.code, 'invalid')
})

test('duplicate-only page is reported as partial, never complete', async () => {
  const first = Array.from({ length: 50 }, (_, i) => q(`p${i}`))
  let saved = null
  const result = await syncHistory({
    fetchPage: stubPages([page(first, 100), page(first, 100)]),
    loadProblems: async () => ({}),
    saveProblems: async (p) => {
      saved = p
    },
    todayDay: TODAY,
    sleep: noopSleep,
  })
  assert.equal(result.status, 'partial')
  assert.equal(result.stats.discovered, 50)
  assert.equal(result.totalNum, 100)
  assert.equal(Object.keys(saved).length, 50)
})

test('retryable failures retry with backoff and then succeed', async () => {
  let calls = 0
  const sleeps = []
  const result = await syncHistory({
    fetchPage: async () => {
      calls++
      if (calls <= MAX_RETRIES) throw new ImportError('http', { retryable: true })
      return page([q('a')], 1)
    },
    loadProblems: async () => ({}),
    saveProblems: async () => {},
    todayDay: TODAY,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  })
  assert.equal(result.status, 'complete')
  assert.equal(calls, MAX_RETRIES + 1)
  assert.deepEqual(sleeps, [1000, 2000])
})

test('retries are bounded', async () => {
  let calls = 0
  const result = await syncHistory({
    fetchPage: async () => {
      calls++
      throw new ImportError('http', { retryable: true })
    },
    loadProblems: async () => ({}),
    saveProblems: async () => {},
    todayDay: TODAY,
    sleep: noopSleep,
  })
  assert.equal(result.status, 'error')
  assert.equal(result.code, 'http')
  assert.equal(calls, MAX_RETRIES + 1)
})

test('save failure reports storage error and returns no problems', async () => {
  const result = await syncHistory({
    fetchPage: stubPages([page([q('a')], 1)]),
    loadProblems: async () => ({}),
    saveProblems: async () => {
      throw new Error('quota exceeded')
    },
    todayDay: TODAY,
    sleep: noopSleep,
  })
  assert.equal(result.status, 'error')
  assert.equal(result.code, 'storage')
  assert.equal(result.problems, undefined)
})

test('load failure reports storage error', async () => {
  const result = await syncHistory({
    fetchPage: stubPages([page([q('a')], 1)]),
    loadProblems: async () => {
      throw new Error('storage unavailable')
    },
    saveProblems: async () => {},
    todayDay: TODAY,
    sleep: noopSleep,
  })
  assert.equal(result.status, 'error')
  assert.equal(result.code, 'storage')
})

test('an empty solved list is complete and saves the existing map unchanged', async () => {
  const existing = { x: { problemId: 'x', nextRevisionAt: '2026-11-01', revisionHistory: [] } }
  let saved = null
  const result = await syncHistory({
    fetchPage: stubPages([page([], 0)]),
    loadProblems: async () => existing,
    saveProblems: async (p) => {
      saved = p
    },
    todayDay: TODAY,
    sleep: noopSleep,
  })
  assert.equal(result.status, 'complete')
  assert.equal(result.stats.discovered, 0)
  assert.deepEqual(saved, existing)
})
