import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DAILY_SELECTION_SIZE,
  ensureDailySelection,
  initializeEligibility,
  isEligible,
  persistDailySelection,
  selectDailyQuestions,
} from './dailySelection.js'

const DAY = '2026-10-21'
const record = (problemId, eligibilityDate = DAY, topics = []) => ({
  problemId,
  eligibilityDate,
  topics,
  revisionHistory: [],
})

const fixedRandom = (...values) => {
  let index = 0
  return () => values[index++] ?? values.at(-1) ?? 0
}

function mockStorage(initial, { failWrites = false } = {}) {
  let state = structuredClone(initial)
  let writes = 0
  return {
    async get() {
      return structuredClone(state)
    },
    async set(next) {
      writes++
      if (failWrites) throw new Error('storage write failed')
      state = structuredClone(next)
    },
    snapshot() {
      return structuredClone(state)
    },
    get writes() {
      return writes
    },
  }
}

async function initializePopupDay(storage, day, random) {
  const { problems, dailySelections } = await storage.get()
  const { problems: migrated } = initializeEligibility(problems, day)
  const selection = selectDailyQuestions(migrated, dailySelections, day, random)
  const nextSelections = dailySelections[day]
    ? dailySelections
    : persistDailySelection(dailySelections, day, selection)
  if (
    JSON.stringify(migrated) !== JSON.stringify(problems) ||
    JSON.stringify(nextSelections) !== JSON.stringify(dailySelections)
  ) {
    await storage.set({ problems: migrated, dailySelections: nextSelections })
  }
  return { problems: migrated, selection }
}

test('popup initialization generates and persists the next local day selection', async () => {
  const storage = mockStorage({
    problems: {
      eligibleA: record('eligibleA', '2026-10-26'),
      eligibleB: record('eligibleB', '2026-10-27'),
      futureA: record('futureA', '2026-10-28'),
      futureB: record('futureB', '2026-10-29'),
    },
    dailySelections: {
      '2026-10-26': ['eligibleA', 'eligibleB'],
    },
  })

  const first = await initializePopupDay(storage, '2026-10-27', fixedRandom(0, 0))
  const saved = storage.snapshot()
  assert.deepEqual(first.selection, ['eligibleA', 'eligibleB'])
  assert.equal(new Set(first.selection).size, 2)
  assert.deepEqual(saved.dailySelections['2026-10-26'], ['eligibleA', 'eligibleB'])
  assert.deepEqual(saved.dailySelections['2026-10-27'], first.selection)
  assert.equal(saved.dailySelections['2026-10-28'], undefined)
  assert.ok(first.selection.every((id) => saved.problems[id].eligibilityDate <= '2026-10-27'))
  assert.ok(!first.selection.some((id) => saved.problems[id].eligibilityDate >= '2026-10-28'))

  const writesAfterFirstOpen = storage.writes
  const second = await initializePopupDay(storage, '2026-10-27', fixedRandom(0.99, 0.99))
  assert.deepEqual(second.selection, first.selection)
  assert.equal(storage.writes, writesAfterFirstOpen)

  const afterRestart = await initializePopupDay(storage, '2026-10-27', fixedRandom(0.5, 0.5))
  assert.deepEqual(afterRestart.selection, first.selection)
  assert.deepEqual(storage.snapshot().dailySelections['2026-10-27'], first.selection)
})

test('popup initialization persists an empty selection without creating a future day', async () => {
  const storage = mockStorage({
    problems: {
      future: record('future', '2026-10-28'),
    },
    dailySelections: {},
  })
  const result = await initializePopupDay(storage, '2026-10-27', fixedRandom(0))
  assert.deepEqual(result.selection, [])
  assert.deepEqual(storage.snapshot().dailySelections, { '2026-10-27': [] })
  assert.equal(storage.snapshot().dailySelections['2026-10-28'], undefined)
})

test('popup initialization surfaces a failed selection write', async () => {
  const storage = mockStorage({
    problems: { eligible: record('eligible', '2026-10-27') },
    dailySelections: {},
  }, { failWrites: true })
  await assert.rejects(
    initializePopupDay(storage, '2026-10-27', fixedRandom(0)),
    /storage write failed/,
  )
})

test('an existing empty selection is regenerated when eligible questions exist', () => {
  const result = ensureDailySelection({
    a: record('a'),
    b: record('b'),
    future: record('future', '2026-10-22'),
  }, {
    [DAY]: [],
  }, DAY, fixedRandom(0, 0))
  assert.deepEqual(result.selection, ['a', 'b'])
  assert.deepEqual(result.dailySelections[DAY], ['a', 'b'])
})

test('an existing non-empty selection is preserved without rerandomizing', () => {
  const result = ensureDailySelection({
    a: record('a'),
    b: record('b'),
  }, {
    [DAY]: ['b', 'a'],
  }, DAY, fixedRandom(0.99, 0.99))
  assert.deepEqual(result.selection, ['b', 'a'])
  assert.deepEqual(result.dailySelections[DAY], ['b', 'a'])
})

test('history-style initialization creates today selection after eligibility setup', () => {
  const imported = Object.fromEntries(
    Array.from({ length: 195 }, (_, index) => {
      const problemId = `problem-${index}`
      return [problemId, {
        ...record(problemId, null),
        imported: true,
      }]
    }),
  )
  const { problems } = initializeEligibility(imported, '2026-10-26')
  const result = ensureDailySelection(problems, { '2026-10-26': [] }, '2026-10-26', fixedRandom(0, 0))
  assert.equal(result.selection.length, 2)
  assert.equal(new Set(result.selection).size, 2)
  assert.deepEqual(result.dailySelections['2026-10-26'], result.selection)
})

test('selects two distinct eligible questions', () => {
  const selected = selectDailyQuestions({
    a: record('a'),
    b: record('b'),
    c: record('c'),
  }, {}, DAY, fixedRandom(0, 0))
  assert.equal(selected.length, DAILY_SELECTION_SIZE)
  assert.equal(new Set(selected).size, 2)
})

test('selects one or none when availability is smaller than two', () => {
  assert.deepEqual(selectDailyQuestions({ a: record('a') }, {}, DAY, fixedRandom(0)), ['a'])
  assert.deepEqual(selectDailyQuestions({}, {}, DAY, fixedRandom(0)), [])
})

test('selection can mix any topics', () => {
  const selected = selectDailyQuestions({
    array: record('array', DAY, ['Array']),
    graphs: record('graphs', DAY, ['Graphs']),
  }, {}, DAY, fixedRandom(0, 0))
  assert.deepEqual(selected, ['array', 'graphs'])
})

test('persisted selection is returned unchanged when requested again', () => {
  const selections = persistDailySelection({}, DAY, ['b', 'a'])
  assert.deepEqual(selectDailyQuestions({
    a: record('a'),
    b: record('b'),
    c: record('c'),
  }, selections, DAY, fixedRandom(0, 0)), ['b', 'a'])
})

test('new local day generates a separate selection', () => {
  const selections = persistDailySelection({}, DAY, ['a', 'b'])
  const next = selectDailyQuestions({
    a: record('a'),
    b: record('b'),
    c: record('c'),
    d: record('d'),
  }, selections, '2026-10-22', fixedRandom(0, 0))
  assert.deepEqual(next, ['c', 'd'])
})

test('recent selections are avoided when alternatives exist', () => {
  const selections = {
    '2026-10-20': ['a', 'b'],
    '2026-10-19': ['c'],
  }
  const selected = selectDailyQuestions({
    a: record('a'),
    b: record('b'),
    c: record('c'),
    d: record('d'),
    e: record('e'),
  }, selections, DAY, fixedRandom(0, 0))
  assert.deepEqual(selected, ['d', 'e'])
})

test('recent-selection restriction is relaxed for small pools', () => {
  const selections = { '2026-10-20': ['a', 'b'] }
  const selected = selectDailyQuestions({
    a: record('a'),
    b: record('b'),
  }, selections, DAY, fixedRandom(0, 0))
  assert.deepEqual(selected, ['a', 'b'])
})

test('future eligibility is excluded and skipped days do not add priority', () => {
  const selections = { '2026-10-19': ['a'] }
  const selected = selectDailyQuestions({
    a: record('a', '2026-10-25'),
    b: record('b', DAY),
  }, selections, DAY, fixedRandom(0))
  assert.deepEqual(selected, ['b'])
})

test('eligibility uses local calendar date and migration is idempotent', () => {
  const problems = {
    known: { ...record('known'), eligibilityDate: null, firstSolvedAt: '2026-10-20T23:00:00.000Z', nextRevisionAt: '2026-10-25' },
    imported: { problemId: 'imported', firstSolvedAt: null, nextRevisionAt: null, revisionHistory: [], imported: true },
  }
  const first = initializeEligibility(problems, DAY)
  const second = initializeEligibility(first.problems, DAY)
  assert.equal(first.problems.known.eligibilityDate, '2026-10-25')
  assert.equal(first.problems.imported.eligibilityDate, DAY)
  assert.deepEqual(second.problems, first.problems)
})

test('ambiguous malformed legacy records stay unchanged and are reported', () => {
  const result = initializeEligibility({
    broken: {
      problemId: 'broken',
      firstSolvedAt: null,
      nextRevisionAt: 'not-a-date',
      revisionHistory: [],
    },
  }, DAY)
  assert.equal(result.problems.broken.eligibilityDate, undefined)
  assert.equal(result.problems.broken.firstSolvedAt, null)
  assert.equal(result.migrationIssues.length, 1)
})

test('isEligible rejects future records', () => {
  assert.equal(isEligible(record('future', '2026-10-22'), DAY), false)
  assert.equal(isEligible(record('today', DAY), DAY), true)
})
