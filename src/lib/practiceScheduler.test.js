import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays, applyRevision } from './revisionScheduler.js'
import {
  PRACTICE_CAP,
  PRACTICE_DAYS,
  buildPracticeSchedule,
  nextWeekStart,
  plannedRecords,
  weekStart,
} from './practiceScheduler.js'

const TODAY = '2026-10-22' // Thursday

function record(problemId, topics, nextRevisionAt, extra = {}) {
  return {
    problemId,
    topics,
    nextRevisionAt,
    revisionHistory: [],
    ...extra,
  }
}

test('weekStart uses Monday and respects local calendar day boundaries', () => {
  assert.equal(weekStart('2026-10-19'), '2026-10-19')
  assert.equal(weekStart(TODAY), '2026-10-19')
  assert.equal(weekStart('2026-10-25'), '2026-10-19')
})

test('nextWeekStart selects the review Monday inside the rolling window', () => {
  assert.equal(nextWeekStart('2026-10-19'), '2026-10-19')
  assert.equal(nextWeekStart('2026-10-22'), '2026-10-26')
  assert.equal(nextWeekStart('2026-10-25'), '2026-10-26')
})

test('rolling schedule covers seven days and caps every queue at three', () => {
  const problems = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => {
      const id = `trees-${index}`
      return [id, record(id, ['Trees'], addDays(TODAY, Math.floor(index / 3)))]
    }),
  )
  const schedule = buildPracticeSchedule(problems, TODAY)
  assert.equal(Object.keys(schedule.assignments).length, PRACTICE_DAYS)
  for (const assignment of Object.values(schedule.assignments)) {
    assert.ok(assignment.problemIds.length <= PRACTICE_CAP)
  }
})

test('each daily queue uses one pattern and never mixes unrelated records', () => {
  const problems = {
    trees: record('trees', ['Two Pointers'], TODAY),
    graphs: record('graphs', ['Graphs'], TODAY),
    heap: record('heap', ['Heap'], addDays(TODAY, 1)),
  }
  const schedule = buildPracticeSchedule(problems, TODAY)
  const today = plannedRecords(problems, schedule.assignments[TODAY])
  assert.equal(new Set(today.map((item) => item.topics[0])).size, 1)
  assert.equal(schedule.backlog.length, 0)
})

test('a future day takes up to three genuinely due questions from its pattern', () => {
  const problems = {
    b1: record('b1', ['Binary Search'], '2026-10-24'),
    b2: record('b2', ['Binary Search'], '2026-10-24'),
    b3: record('b3', ['Binary Search'], '2026-10-24'),
    trees: record('trees', ['Trees'], '2026-10-24'),
  }
  const schedule = buildPracticeSchedule(problems, TODAY)
  assert.equal(schedule.assignments['2026-10-24'].topic, 'Binary Search')
  assert.deepEqual(schedule.assignments['2026-10-24'].problemIds, ['b1', 'b2', 'b3'])
})

test('a future day keeps a smaller due pattern rather than replacing it with imports', () => {
  const problems = {
    binary: record('binary', ['Binary Search'], '2026-10-24'),
    importedA: record('imported-a', ['Trees'], null, { imported: true }),
    importedB: record('imported-b', ['Trees'], null, { imported: true }),
    importedC: record('imported-c', ['Trees'], null, { imported: true }),
  }
  const schedule = buildPracticeSchedule(problems, TODAY)
  assert.deepEqual(schedule.assignments['2026-10-24'].problemIds, ['binary'])
  assert.equal(schedule.assignments['2026-10-24'].topic, 'Binary Search')
})

test('anti-repeat keeps a larger candidate group instead of choosing a smaller alternative', () => {
  const problems = {
    binaryA: record('binary-a', ['Binary Search'], '2026-10-23'),
    binaryB: record('binary-b', ['Binary Search'], '2026-10-23'),
    binaryC: record('binary-c', ['Binary Search'], '2026-10-23'),
    binaryD: record('binary-d', ['Binary Search'], '2026-10-24'),
    binaryE: record('binary-e', ['Binary Search'], '2026-10-24'),
    binaryF: record('binary-f', ['Binary Search'], '2026-10-24'),
    sorting: record('sorting', ['Sorting'], '2026-10-24'),
  }
  const schedule = buildPracticeSchedule(problems, '2026-10-23')
  assert.equal(schedule.assignments['2026-10-23'].topic, 'Binary Search')
  assert.equal(schedule.assignments['2026-10-23'].problemIds.length, 3)
  assert.equal(schedule.assignments['2026-10-24'].topic, 'Binary Search')
  assert.deepEqual(schedule.assignments['2026-10-24'].problemIds, ['binary-d', 'binary-e', 'binary-f'])
})

test('a future day with fewer than three eligible questions remains below the cap', () => {
  const problems = {
    b1: record('b1', ['Binary Search'], '2026-10-24'),
    b2: record('b2', ['Binary Search'], '2026-10-24'),
  }
  const schedule = buildPracticeSchedule(problems, TODAY)
  assert.deepEqual(schedule.assignments['2026-10-24'].problemIds, ['b1', 'b2'])
})

test('Monday reviews at most three most-overdue questions from one pattern', () => {
  const monday = '2026-10-19'
  const problems = {
    t1: record('t1', ['Trees'], '2026-10-10'),
    t2: record('t2', ['Trees'], '2026-10-11'),
    t3: record('t3', ['Trees'], '2026-10-12'),
    t4: record('t4', ['Trees'], '2026-10-13'),
    g1: record('g1', ['Graphs'], '2026-10-09'),
  }
  const schedule = buildPracticeSchedule(problems, monday)
  const assignment = schedule.assignments[monday]
  assert.equal(assignment.weeklyOverdueReview, true)
  assert.equal(assignment.topic, 'Graphs')
  assert.deepEqual(assignment.problemIds, ['g1'])
  assert.equal(schedule.backlog.length, 4)
})

test('Monday review keeps a two-question selected pattern and retains other overdue patterns', () => {
  const problems = {
    stock: record('stock', ['Array', 'Dynamic Programming', 'Greedy'], '2026-10-18'),
    stairs: record('stairs', ['Dynamic Programming', 'Math'], '2026-10-19'),
    graphA: record('graph-a', ['Graphs'], '2026-10-20'),
    graphB: record('graph-b', ['Graphs'], '2026-10-21'),
    graphC: record('graph-c', ['Graphs'], '2026-10-22'),
  }
  const schedule = buildPracticeSchedule(problems, '2026-10-26')
  const assignment = schedule.assignments['2026-10-26']

  assert.equal(assignment.topic, 'Dynamic Programming')
  assert.deepEqual(assignment.problemIds, ['stock', 'stairs'])
  assert.equal(schedule.backlog.length, 3)
  assert.deepEqual(schedule.backlog.map((item) => item.problemId), ['graph-a', 'graph-b', 'graph-c'])
})

test('Monday review includes the third eligible question from the selected pattern', () => {
  const problems = {
    stock: record('stock', ['Dynamic Programming', 'Greedy'], '2026-10-18'),
    stairs: record('stairs', ['Dynamic Programming', 'Math'], '2026-10-19'),
    climb: record('climb', ['Dynamic Programming'], '2026-10-20'),
    graph: record('graph', ['Graphs'], '2026-10-21'),
  }
  const schedule = buildPracticeSchedule(problems, '2026-10-26')
  const assignment = schedule.assignments['2026-10-26']

  assert.equal(assignment.topic, 'Dynamic Programming')
  assert.deepEqual(assignment.problemIds, ['stock', 'stairs', 'climb'])
  assert.equal(schedule.backlog.length, 1)
  assert.deepEqual(schedule.backlog.map((item) => item.problemId), ['graph'])
})

test('a rolling window starting before Monday includes the next Monday overdue review', () => {
  const problems = {
    oldestA: record('oldest-a', ['Trees'], '2026-10-18'),
    oldestB: record('oldest-b', ['Trees'], '2026-10-19'),
    oldestC: record('oldest-c', ['Trees'], '2026-10-20'),
    oldestD: record('oldest-d', ['Trees'], '2026-10-21'),
  }
  const schedule = buildPracticeSchedule(problems, '2026-10-23')
  const assignment = schedule.assignments['2026-10-26']
  assert.equal(assignment.weeklyOverdueReview, true)
  assert.deepEqual(assignment.problemIds, ['oldest-a', 'oldest-b', 'oldest-c'])
  assert.deepEqual(schedule.assignments['2026-10-27'].problemIds, [])
  assert.deepEqual(schedule.backlog.map((item) => item.problemId), ['oldest-d'])
})

test('planned assignments do not modify genuine due dates or history', () => {
  const history = [{ reviewedAt: '2026-10-20T10:00:00.000Z', result: 'remembered', nextRevisionAt: '2026-10-23' }]
  const original = record('trees', ['Trees'], '2026-10-23', { revisionHistory: history })
  const problems = { trees: original }
  const schedule = buildPracticeSchedule(problems, TODAY)
  assert.equal(plannedRecords(problems, schedule.assignments['2026-10-23'])[0], original)
  assert.equal(original.nextRevisionAt, '2026-10-23')
  assert.deepEqual(original.revisionHistory, history)
})

test('schedule generation is idempotent and does not duplicate assignments', () => {
  const problems = {
    a: record('a', ['Two Pointers'], TODAY),
    b: record('b', ['Two Pointers'], TODAY),
    c: record('c', ['Two Pointers'], TODAY),
    d: record('d', ['Two Pointers'], TODAY),
  }
  const first = buildPracticeSchedule(problems, TODAY)
  const second = buildPracticeSchedule(problems, TODAY)
  assert.deepEqual(second, first)
  const assigned = Object.values(first.assignments).flatMap((assignment) => assignment.problemIds)
  assert.equal(new Set(assigned).size, assigned.length)
})

test('remembered and forgotten intervals remain owned by revisionScheduler', () => {
  const original = record('a', ['Trees'], TODAY)
  const remembered = applyRevision(original, 'remembered', '2026-10-22T09:00:00.000Z')
  const forgotten = applyRevision(original, 'forgotten', '2026-10-22T09:00:00.000Z')
  assert.equal(remembered.nextRevisionAt, '2026-10-25')
  assert.equal(forgotten.nextRevisionAt, '2026-10-23')
})

test('pending imported questions enter the next rolling window without storage dates', () => {
  const imported = record('imported', ['Trees'], null, { imported: true })
  const problems = { imported }
  const schedule = buildPracticeSchedule(problems, TODAY)
  const planned = plannedRecords(problems, schedule.assignments['2026-10-23'])

  assert.equal(planned[0].problemId, 'imported')
  assert.equal(planned[0].nextRevisionAt, '2026-10-23')
  assert.equal(imported.nextRevisionAt, null)
  assert.deepEqual(imported.revisionHistory, [])
})

test('pending imports are not added to Monday overdue review or backlog', () => {
  const problems = {
    imported: record('imported', ['Trees'], null, { imported: true }),
    overdue: record('overdue', ['Graphs'], '2026-10-18'),
  }
  const schedule = buildPracticeSchedule(problems, '2026-10-19')
  assert.deepEqual(schedule.assignments['2026-10-19'].problemIds, ['overdue'])
  assert.equal(schedule.backlog.length, 0)
  assert.deepEqual(schedule.assignments['2026-10-20'].problemIds, ['imported'])
})

test('overdue backlog remains separate on Tuesday after Monday review', () => {
  const problems = Object.fromEntries(
    Array.from({ length: 5 }, (_, index) => {
      const id = `trees-${index}`
      return [id, record(id, ['Trees'], `2026-10-${String(10 + index).padStart(2, '0')}`)]
    }),
  )
  const schedule = buildPracticeSchedule(problems, '2026-10-20')
  assert.equal(schedule.assignments['2026-10-20'].weeklyOverdueReview, false)
  assert.deepEqual(schedule.assignments['2026-10-20'].problemIds, [])
  assert.equal(schedule.backlog.length, 2)
})

test('Sunday-to-Monday transition activates the weekly review queue', () => {
  const problems = {
    a: record('a', ['Trees'], '2026-10-17'),
    b: record('b', ['Trees'], '2026-10-18'),
    c: record('c', ['Trees'], '2026-10-18'),
    d: record('d', ['Trees'], '2026-10-18'),
  }
  const sunday = buildPracticeSchedule(problems, '2026-10-18')
  const monday = buildPracticeSchedule(problems, '2026-10-19')
  assert.equal(sunday.assignments['2026-10-18'].weeklyOverdueReview, false)
  assert.equal(monday.assignments['2026-10-19'].weeklyOverdueReview, true)
  assert.equal(monday.assignments['2026-10-19'].problemIds.length, 3)
})

test('a revised question is regenerated from its new genuine due date', () => {
  const original = record('a', ['Trees'], TODAY)
  const reviewed = applyRevision(original, 'remembered', '2026-10-22T09:00:00.000Z')
  const schedule = buildPracticeSchedule({ a: reviewed }, TODAY)
  assert.deepEqual(schedule.assignments['2026-10-25'].problemIds, ['a'])
  assert.equal(reviewed.nextRevisionAt, '2026-10-25')
  assert.equal(reviewed.revisionHistory.length, 1)
})

test('rolling planning remains correct across month and year boundaries', () => {
  const schedule = buildPracticeSchedule({
    month: record('month', ['Trees'], '2026-12-31'),
    year: record('year', ['Graphs'], '2027-01-01'),
  }, '2026-12-31')
  assert.deepEqual(Object.keys(schedule.assignments), [
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
    '2027-01-03',
    '2027-01-04',
    '2027-01-05',
    '2027-01-06',
  ])
})
