import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OTHER, dayPlan, dueOrder, groupByTopic, normalizeTopics, primaryTopic, selectDailyPattern } from './patterns.js'

const rec = (problemId, topics, nextRevisionAt = '2026-10-21') => ({
  problemId,
  title: problemId,
  topics,
  nextRevisionAt,
})

test('normalizeTopics: missing/empty/malformed -> []', () => {
  assert.deepEqual(normalizeTopics(undefined), [])
  assert.deepEqual(normalizeTopics(null), [])
  assert.deepEqual(normalizeTopics('Array'), [])
  assert.deepEqual(normalizeTopics([1, 2, {}, '']), [])
})

test('normalizeTopics: trims, drops empties, dedupes, accepts {name}', () => {
  assert.deepEqual(normalizeTopics([' Array ', 'Array', '', '  ', 'Hash Table']), [
    'Array',
    'Hash Table',
  ])
  assert.deepEqual(normalizeTopics([{ name: 'Sliding Window' }, { name: 'Sliding Window' }]), [
    'Sliding Window',
  ])
})

test('primaryTopic: one useful topic wins', () => {
  assert.equal(primaryTopic(rec('a', ['Array', 'Two Pointers'])), 'Two Pointers')
})

test('primaryTopic: all-generic falls back to a deterministic generic', () => {
  assert.equal(primaryTopic(rec('a', ['String', 'Array'])), 'Array')
})

test('primaryTopic: no valid topics -> null', () => {
  assert.equal(primaryTopic(rec('a', [])), null)
  assert.equal(primaryTopic(rec('a', undefined)), null)
})

test('primaryTopic: stable regardless of source ordering', () => {
  assert.equal(primaryTopic(rec('a', ['Trees', 'Binary Search'])), 'Binary Search')
  assert.equal(primaryTopic(rec('a', ['Binary Search', 'Trees'])), 'Binary Search')
})

test('primaryTopic: unknown/new tags work without code changes', () => {
  assert.equal(primaryTopic(rec('a', ['Monotonic Stack'])), 'Monotonic Stack')
})

test('groupByTopic: headings alphabetical, Other last', () => {
  const list = [
    rec('z', ['Sliding Window']),
    rec('y', ['Binary Search']),
    rec('x', []),
    rec('w', ['Two Pointers']),
  ]
  assert.deepEqual(
    groupByTopic(list).map(([k]) => k),
    ['Binary Search', 'Sliding Window', 'Two Pointers', OTHER],
  )
})

test('groupByTopic: multi-topic problem appears exactly once', () => {
  const list = [rec('a', ['Array', 'Two Pointers']), rec('b', ['Two Pointers'])]
  const flat = groupByTopic(list).flatMap(([, rs]) => rs.map((r) => r.problemId))
  assert.deepEqual(flat.sort(), ['a', 'b'])
  assert.equal(flat.length, 2)
  const two = groupByTopic(list).find(([k]) => k === 'Two Pointers')
  assert.deepEqual(two[1].map((r) => r.problemId), ['a', 'b'])
})

test('groupByTopic: within-group oldest-due-first, equal dates by slug', () => {
  const list = [
    rec('later', ['Trees'], '2026-10-25'),
    rec('b', ['Trees'], '2026-10-20'),
    rec('a', ['Trees'], '2026-10-20'),
  ]
  const [[, rows]] = groupByTopic(list)
  assert.deepEqual(rows.map((r) => r.problemId), ['a', 'b', 'later'])
})

test('groupByTopic: identical input -> identical output (deterministic)', () => {
  const list = [rec('b', ['Heap']), rec('a', ['Heap']), rec('c', ['Array'])]
  assert.deepEqual(
    JSON.stringify(groupByTopic(list)),
    JSON.stringify(groupByTopic(list)),
  )
})

test('groupByTopic: empty list -> no groups', () => {
  assert.deepEqual(groupByTopic([]), [])
})

// --- daily focus selection -----------------------------------------------

const day = '2026-10-21'
const due = (problemId, topics, at = day) => rec(problemId, topics, at)

test('selectDailyPattern: deterministic for identical input', () => {
  const list = [due('a', ['Trees']), due('b', ['Graphs'])]
  assert.equal(selectDailyPattern(list, day), selectDailyPattern(list, day))
})

test('selectDailyPattern: overdue pattern outranks a larger non-overdue group', () => {
  const list = [due('a', ['Trees'], '2026-10-18'), due('b', ['Graphs']), due('c', ['Graphs'])]
  assert.equal(selectDailyPattern(list, day), 'Trees')
})

test('selectDailyPattern: larger group wins when neither is overdue', () => {
  const list = [due('a', ['Trees']), due('b', ['Graphs']), due('c', ['Graphs'])]
  assert.equal(selectDailyPattern(list, day), 'Graphs')
})

test('selectDailyPattern: alphabetical tie-break', () => {
  const list = [due('a', ['Trees']), due('b', ['Graphs'])]
  assert.equal(selectDailyPattern(list, day), 'Graphs')
})

test('selectDailyPattern: generic-only and untagged produce no focus', () => {
  assert.equal(selectDailyPattern([due('a', ['Array']), due('b', [])], day), null)
})

test('dayPlan: focus capped at three, extras of the focus topic drop out', () => {
  const list = ['a', 'b', 'c', 'd'].map((s) => due(s, ['Trees']))
  const plan = dayPlan(list, day)
  assert.equal(plan.focusTopic, 'Trees')
  assert.equal(plan.focus.length, 3)
  assert.equal(plan.overdue.length, 0)
})

test('dayPlan: fewer than three available shows only what exists', () => {
  const plan = dayPlan([due('a', ['Trees'])], day)
  assert.equal(plan.focus.length, 1)
})

test('dayPlan: overdue from another pattern is carried into overdue (never lost)', () => {
  const list = [
    due('f1', ['Trees'], '2026-10-18'),
    due('f2', ['Trees'], '2026-10-18'),
    due('o', ['Graphs'], '2026-10-18'),
  ]
  const plan = dayPlan(list, day)
  assert.equal(plan.focusTopic, 'Trees') // larger overdue group wins focus
  assert.equal(plan.focus.length, 2)
  assert.deepEqual(plan.overdue.map((r) => r.problemId), ['o']) // not lost
})

test('dayPlan: untagged go to other, never focus or overdue', () => {
  const plan = dayPlan([due('x', []), due('a', ['Trees'])], day)
  assert.deepEqual(plan.other.map((r) => r.problemId), ['x'])
  assert.deepEqual(plan.focus.map((r) => r.problemId), ['a'])
})

test('dayPlan: multi-topic problem appears exactly once across sections', () => {
  const list = [due('a', ['Array', 'Two Pointers']), due('b', ['Two Pointers'])]
  const plan = dayPlan(list, day)
  const all = [...plan.focus, ...plan.overdue, ...plan.other].map((r) => r.problemId)
  assert.equal(new Set(all).size, all.length)
  assert.equal(all.length, 2)
})

test('dayPlan: nothing due -> empty plan', () => {
  const plan = dayPlan([due('a', ['Trees'], '2026-12-01')], day)
  assert.deepEqual(plan, { focusTopic: null, focus: [], overdue: [], other: [] })
})

test('dueOrder: oldest first, slug tie-break', () => {
  const list = [rec('c', ['x'], '2026-10-25'), rec('b', ['x'], '2026-10-20'), rec('a', ['x'], '2026-10-20')]
  assert.deepEqual(dueOrder(list).map((r) => r.problemId), ['a', 'b', 'c'])
})


test('dayPlan: generic-only problems go to other, not focus', () => {
  const plan = dayPlan([due('g', ['Array', 'Hash Table']), due('a', ['Trees'])], day)
  assert.deepEqual(plan.other.map((r) => r.problemId), ['g'])
  assert.deepEqual(plan.focus.map((r) => r.problemId), ['a'])
})

test('dayPlan: non-focus, not-overdue problems wait (not shown today)', () => {
  const list = [due('x', ['Trees']), due('x2', ['Trees']), due('y', ['Graphs'])]
  const plan = dayPlan(list, day)
  assert.equal(plan.focusTopic, 'Trees')
  assert.deepEqual(plan.focus.map((r) => r.problemId), ['x', 'x2'])
  assert.equal(plan.overdue.length, 0)
  assert.equal(plan.other.length, 0)
})


// Heading data contract: whenever focus has cards, a heading topic exists,
// so the UI never renders a count with no title (the regression).
test('dayPlan: focus cards always come with a focus topic', () => {
  const plans = [
    dayPlan([due('a', ['Trees']), due('b', ['Trees'])], day),
    dayPlan([due('a', ['Graphs'], '2026-10-18')], day),
    dayPlan([], day),
  ]
  for (const p of plans) {
    if (p.focus.length > 0) assert.ok(p.focusTopic, 'focus non-empty implies a heading')
    else assert.equal(p.focusTopic, null)
  }
})

