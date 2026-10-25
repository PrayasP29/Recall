import test from 'node:test'
import assert from 'node:assert/strict'
import {
  toLocalDay,
  addDays,
  initialDueDay,
  withInitialSchedule,
  reconcileSchedules,
  isDue,
  dueProblems,
  calendarEvents,
} from './revisionScheduler.js'

// Built from LOCAL components → deterministic in any machine timezone.
const iso = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString()

const rec = (over = {}) => ({
  problemId: 'two-sum',
  title: 'Two Sum',
  url: 'https://leetcode.com/problems/two-sum/',
  difficulty: 'Easy',
  firstSolvedAt: iso(2026, 10, 20),
  lastAcceptedAt: iso(2026, 10, 20),
  revisionHistory: [],
  nextRevisionAt: '2026-10-21',
  ...over,
})

// --- date foundations -----------------------------------------------------

test('toLocalDay uses the local calendar day', () => {
  assert.equal(toLocalDay(new Date(2026, 0, 5, 23, 30)), '2026-01-05')
})

test('addDays crosses month, year, and leap boundaries correctly', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01') // month boundary
  assert.equal(addDays('2026-12-31', 1), '2027-01-01') // year boundary
  assert.equal(addDays('2028-02-28', 1), '2028-02-29') // leap year
  assert.equal(addDays('2026-02-28', 1), '2026-03-01') // non-leap year
  assert.equal(addDays('2100-02-28', 1), '2100-03-01') // 400-rule: 2100 not a leap year
  assert.equal(addDays('2026-01-15', -5), '2026-01-10')
})

test('initial revision is due three local calendar days later', () => {
  assert.equal(initialDueDay(iso(2026, 10, 20, 23)), '2026-10-23') // late-night solve still counts as that day
})

// --- scheduling rules -----------------------------------------------------

// --- legacy migration -----------------------------------------------------

test('withInitialSchedule schedules null nextRevisionAt from firstSolvedAt', () => {
  const legacy = rec({ nextRevisionAt: null })
  const migrated = withInitialSchedule(legacy)
  assert.equal(migrated.nextRevisionAt, '2026-10-23')
  assert.equal(migrated.firstSolvedAt, legacy.firstSolvedAt) // untouched
})

test('withInitialSchedule is a no-op for scheduled or incomplete records', () => {
  const scheduled = rec()
  assert.equal(withInitialSchedule(scheduled), scheduled) // identity
  const noSolveDate = rec({ firstSolvedAt: null, nextRevisionAt: null })
  assert.equal(withInitialSchedule(noSolveDate), noSolveDate)
})

test('reconciliation caps legacy clusters without deleting history', () => {
  const history = [{ reviewedAt: iso(2026, 10, 1, 9), result: 'forgotten', nextRevisionAt: '2026-10-20' }]
  const problems = Object.fromEntries(
    ['a', 'b', 'c', 'd'].map((problemId) => [
      problemId,
      rec({ problemId, nextRevisionAt: '2026-10-20', revisionHistory: history }),
    ]),
  )
  const { problems: migrated } = reconcileSchedules(problems)
  const days = Object.values(migrated).map((record) => record.nextRevisionAt)
  assert.deepEqual(days, ['2026-10-20', '2026-10-20', '2026-10-20', '2026-10-21'])
  assert.deepEqual(migrated.a.revisionHistory, history)
  assert.deepEqual(reconcileSchedules(migrated).problems, migrated)
})

test('reconciliation repairs a 1970 date only from reliable existing data', () => {
  const repairable = rec({ nextRevisionAt: '1970-01-02' })
  const ambiguous = rec({ problemId: 'ambiguous', firstSolvedAt: null, nextRevisionAt: '1970-01-02' })
  const result = reconcileSchedules({ repairable, ambiguous })
  assert.equal(result.problems.repairable.nextRevisionAt, '2026-10-23')
  assert.equal(result.problems.ambiguous.nextRevisionAt, '1970-01-02')
  assert.deepEqual(result.migrationIssues, [
    { problemId: 'ambiguous', reason: 'invalid nextRevisionAt with no reliable firstSolvedAt' },
  ])
})

// --- due queue ------------------------------------------------------------

test('isDue: due today and overdue are actionable; future and null are not', () => {
  assert.equal(isDue(rec({ nextRevisionAt: '2026-10-20' }), '2026-10-20'), true)
  assert.equal(isDue(rec({ nextRevisionAt: '2026-10-18' }), '2026-10-20'), true)
  assert.equal(isDue(rec({ nextRevisionAt: '2026-10-21' }), '2026-10-20'), false) // no premature action
  assert.equal(isDue(rec({ nextRevisionAt: null }), '2026-10-20'), false)
})

test('dueProblems includes due-today and overdue, sorted oldest first, excludes future/null', () => {
  const problems = {
    future: rec({ problemId: 'future', nextRevisionAt: '2026-10-25' }),
    overdue: rec({ problemId: 'overdue', nextRevisionAt: '2026-10-18' }),
    today: rec({ problemId: 'today', nextRevisionAt: '2026-10-20' }),
    unscheduled: rec({ problemId: 'unscheduled', nextRevisionAt: null }),
  }
  const due = dueProblems(problems, '2026-10-20')
  assert.deepEqual(due.map((r) => r.problemId), ['overdue', 'today'])
})

// --- calendar -------------------------------------------------------------

test('calendarEvents marks solved and revision dates', () => {
  const r = rec()
  const events = calendarEvents({ 'two-sum': r }, 2026, 9) // October (0-based)
  assert.deepEqual(events['2026-10-05'], undefined) // quiet day absent
  assert.deepEqual(events['2026-10-20'].solved, [r])
  assert.deepEqual(events['2026-10-21'].revisions, [r])
})

test('multiple problems on the same date all appear', () => {
  const a = rec({ problemId: 'a' })
  const b = rec({ problemId: 'b' })
  const events = calendarEvents({ a, b }, 2026, 9)
  assert.deepEqual(events['2026-10-20'].solved.map((r) => r.problemId), ['a', 'b'])
  assert.deepEqual(events['2026-10-21'].revisions.map((r) => r.problemId), ['a', 'b'])
})

test('month and year boundaries stay in their own month view', () => {
  const r = rec({ firstSolvedAt: iso(2026, 10, 31), nextRevisionAt: '2026-11-01' })
  const oct = calendarEvents({ r }, 2026, 9)
  assert.ok(oct['2026-10-31'].solved.length === 1)
  assert.equal(oct['2026-11-01'], undefined) // November date not in October view
  const nov = calendarEvents({ r }, 2026, 10)
  assert.deepEqual(nov['2026-11-01'].revisions, [r])
})

test('leap-year Feb 29 solve shows in the February view', () => {
  const r = rec({ firstSolvedAt: iso(2024, 2, 29, 9), nextRevisionAt: null })
  const events = calendarEvents({ r }, 2024, 1)
  assert.deepEqual(events['2024-02-29'].solved, [r])
})
