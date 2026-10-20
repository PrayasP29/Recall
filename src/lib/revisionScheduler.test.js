import test from 'node:test'
import assert from 'node:assert/strict'
import {
  toLocalDay,
  addDays,
  initialDueDay,
  withInitialSchedule,
  applyRevision,
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

test('initial revision is due the following calendar day', () => {
  assert.equal(initialDueDay(iso(2026, 10, 20, 23)), '2026-10-21') // late-night solve still counts as that day
})

// --- scheduling rules -----------------------------------------------------

test('remembered intervals: 3, 7, 14, then 30 days by consecutive streak', () => {
  let r = rec()
  const due = (result, y, m, d) => {
    r = applyRevision(r, result, iso(y, m, d, 9))
    return r.nextRevisionAt
  }
  assert.equal(due('remembered', 2026, 10, 21), '2026-10-24') // streak 1: +3
  assert.equal(due('remembered', 2026, 10, 24), '2026-10-31') // streak 2: +7
  assert.equal(due('remembered', 2026, 10, 31), '2026-11-14') // streak 3: +14
  assert.equal(due('remembered', 2026, 11, 14), '2026-12-14') // streak 4: +30
  assert.equal(due('remembered', 2026, 12, 14), '2027-01-13') // streak 5: still +30
})

test('forgotten: due next day and the streak resets', () => {
  let r = applyRevision(rec(), 'remembered', iso(2026, 10, 21, 9)) // streak 1
  r = applyRevision(r, 'forgotten', iso(2026, 10, 24, 9))
  assert.equal(r.nextRevisionAt, '2026-10-25') // following day
  r = applyRevision(r, 'remembered', iso(2026, 10, 25, 9))
  assert.equal(r.nextRevisionAt, '2026-10-28') // streak restarted at 3 days
})

test('revision entries carry reviewedAt/result/nextRevisionAt and history is preserved', () => {
  const r = applyRevision(rec(), 'remembered', iso(2026, 10, 21, 9))
  assert.deepEqual(r.revisionHistory, [
    { reviewedAt: iso(2026, 10, 21, 9), result: 'remembered', nextRevisionAt: '2026-10-24' },
  ])
  const r2 = applyRevision(r, 'forgotten', iso(2026, 10, 24, 9))
  assert.equal(r2.revisionHistory.length, 2)
  assert.equal(r2.revisionHistory[0].reviewedAt, iso(2026, 10, 21, 9))
})

test('repeated attempts with the same reviewedAt are ignored (double-click guard)', () => {
  const at = iso(2026, 10, 21, 9)
  const once = applyRevision(rec(), 'remembered', at)
  const twice = applyRevision(once, 'remembered', at)
  assert.equal(twice, once) // same object identity = nothing recorded
  assert.equal(once.revisionHistory.length, 1)
})

// --- legacy migration -----------------------------------------------------

test('withInitialSchedule schedules null nextRevisionAt from firstSolvedAt', () => {
  const legacy = rec({ nextRevisionAt: null })
  const migrated = withInitialSchedule(legacy)
  assert.equal(migrated.nextRevisionAt, '2026-10-21')
  assert.equal(migrated.firstSolvedAt, legacy.firstSolvedAt) // untouched
})

test('withInitialSchedule is a no-op for scheduled or incomplete records', () => {
  const scheduled = rec()
  assert.equal(withInitialSchedule(scheduled), scheduled) // identity
  const noSolveDate = rec({ firstSolvedAt: null, nextRevisionAt: null })
  assert.equal(withInitialSchedule(noSolveDate), noSolveDate)
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
