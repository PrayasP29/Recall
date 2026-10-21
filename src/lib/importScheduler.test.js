import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays } from './revisionScheduler.js'
import { IMPORT_CAP_PER_DAY, assignImportSchedules } from './importScheduler.js'

const TODAY = '2026-10-21'
const DAY1 = addDays(TODAY, 1)

const imported = (slug, over = {}) => ({
  problemId: slug,
  title: slug,
  url: `https://leetcode.com/problems/${slug}/`,
  difficulty: 'Medium',
  firstSolvedAt: null, // date unknown for imported problems
  lastAcceptedAt: null,
  revisionHistory: [],
  nextRevisionAt: null,
  imported: true,
  ...over,
})

const tracked = (slug, nextRevisionAt, over = {}) => ({
  problemId: slug,
  title: slug,
  url: `https://leetcode.com/problems/${slug}/`,
  difficulty: 'Easy',
  firstSolvedAt: '2026-09-01T12:00:00.000Z',
  lastAcceptedAt: '2026-09-01T12:00:00.000Z',
  revisionHistory: [],
  nextRevisionAt,
  ...over,
})

// Groups scheduled day -> problemIds, for readable assertions.
const byDay = (problems) => {
  const out = {}
  for (const rec of Object.values(problems)) {
    if (rec.imported) (out[rec.nextRevisionAt] ??= []).push(rec.problemId)
  }
  for (const ids of Object.values(out)) ids.sort()
  return out
}

// Total scheduled load per day (existing revisions + imported problems).
const totalByDay = (problems) => {
  const out = {}
  for (const rec of Object.values(problems)) {
    if (rec.nextRevisionAt) (out[rec.nextRevisionAt] ??= []).push(rec.problemId)
  }
  return out
}

test('cap is exactly 3 newly imported problems per day', () => {
  assert.equal(IMPORT_CAP_PER_DAY, 3)
  const problems = Object.fromEntries(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => [s, imported(s)]),
  )
  const out = assignImportSchedules(problems, TODAY)
  assert.deepEqual(byDay(out), {
    [DAY1]: ['a', 'b', 'c'],
    [addDays(DAY1, 1)]: ['d', 'e', 'f'],
    [addDays(DAY1, 2)]: ['g', 'h'],
  })
})

test('scheduling is deterministic regardless of input order', () => {
  const entries = ['m', 'a', 'z', 'c', 'b'].map((s) => [s, imported(s)])
  const a = assignImportSchedules(Object.fromEntries(entries), TODAY)
  const b = assignImportSchedules(Object.fromEntries([...entries].reverse()), TODAY)
  assert.deepEqual(byDay(a), byDay(b))
  assert.deepEqual(byDay(a), {
    [DAY1]: ['a', 'b', 'c'],
    [addDays(DAY1, 1)]: ['m', 'z'],
  })
})

test('existing revisions consume daily capacity but are never changed', () => {
  const existing = {
    x: tracked('x', DAY1),
    y: tracked('y', DAY1),
    z: tracked('z', DAY1, { revisionHistory: [{ reviewedAt: '2026-10-20T00:00:00.000Z', result: 'remembered', nextRevisionAt: DAY1 }] }),
  }
  const problems = {
    ...existing,
    a: imported('a'),
    b: imported('b'),
    c: imported('c'),
  }
  const out = assignImportSchedules(problems, TODAY)
  // Day 1 already has 3 revisions, so no imports land there.
  assert.equal(out.a.nextRevisionAt, addDays(DAY1, 1))
  assert.equal(out.b.nextRevisionAt, addDays(DAY1, 1))
  assert.equal(out.c.nextRevisionAt, addDays(DAY1, 1))
  for (const rec of Object.values(existing)) {
    assert.deepEqual(out[rec.problemId], rec)
  }
})

test('a partly loaded day takes only the remaining slots', () => {
  const problems = {
    x: tracked('x', DAY1),
    a: imported('a'),
    b: imported('b'),
    c: imported('c'),
    d: imported('d'),
  }
  const out = assignImportSchedules(problems, TODAY)
  assert.equal(out.a.nextRevisionAt, DAY1)
  assert.equal(out.b.nextRevisionAt, DAY1)
  assert.equal(out.c.nextRevisionAt, addDays(DAY1, 1))
  assert.equal(out.d.nextRevisionAt, addDays(DAY1, 1))
})

test('already scheduled imports keep their date and history (repeated sync is a no-op)', () => {
  const scheduled = imported('a', {
    nextRevisionAt: '2026-11-15',
    revisionHistory: [{ reviewedAt: '2026-11-01T00:00:00.000Z', result: 'forgotten', nextRevisionAt: '2026-11-15' }],
  })
  const problems = { a: scheduled, b: imported('b') }
  const out = assignImportSchedules(problems, TODAY)
  assert.deepEqual(out.a, scheduled)
  // Re-running changes nothing for the already-scheduled record.
  assert.deepEqual(assignImportSchedules(out, TODAY).a, scheduled)
})

test('unscheduled non-imported records are left alone', () => {
  const legacy = tracked('legacy', null)
  const out = assignImportSchedules({ legacy }, TODAY)
  assert.equal(out.legacy.nextRevisionAt, null)
})

test('returns the same reference when there is nothing to import', () => {
  const problems = { x: tracked('x', DAY1) }
  assert.equal(assignImportSchedules(problems, TODAY), problems)
})

test('no day ever exceeds 3 total scheduled problems (existing + imported)', () => {
  const problems = {
    x: tracked('x', DAY1),
    y: tracked('y', DAY1),
    p: tracked('p', addDays(DAY1, 1)),
    q: tracked('q', addDays(DAY1, 2)),
    r: tracked('r', addDays(DAY1, 2)),
  }
  for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
    problems[s] = imported(s)
  }
  const out = assignImportSchedules(problems, TODAY)
  for (const [day, ids] of Object.entries(totalByDay(out))) {
    assert.ok(ids.length <= IMPORT_CAP_PER_DAY, `${day} has ${ids.length} scheduled problems`)
  }
  // Day 1 has 2 existing revisions, so exactly one import fits there.
  assert.equal(out.a.nextRevisionAt, DAY1)
  assert.equal(out.b.nextRevisionAt, addDays(DAY1, 1))
})

test('a day already over the cap (4 existing) accepts no imports', () => {
  const problems = { a: imported('a'), b: imported('b') }
  for (const s of ['w', 'x', 'y', 'z']) problems[s] = tracked(s, DAY1)
  const out = assignImportSchedules(problems, TODAY)
  assert.equal(out.a.nextRevisionAt, addDays(DAY1, 1))
  assert.equal(out.b.nextRevisionAt, addDays(DAY1, 1))
  assert.equal(out.w.nextRevisionAt, DAY1)
  assert.equal(out.z.nextRevisionAt, DAY1)
})

test('non-empty revisionHistory is never rescheduled, even with a null date', () => {
  const historyOnly = imported('a', {
    nextRevisionAt: null,
    revisionHistory: [{ reviewedAt: '2026-10-20T00:00:00.000Z', result: 'remembered', nextRevisionAt: null }],
  })
  const out = assignImportSchedules({ a: historyOnly, b: imported('b') }, TODAY)
  assert.deepEqual(out.a, historyOnly)
  assert.equal(out.b.nextRevisionAt, DAY1)
})

test('two runs over the same dataset produce an identical map', () => {
  const problems = {
    x: tracked('x', DAY1),
    a: imported('a'),
    b: imported('b'),
    c: imported('c'),
    d: imported('d'),
    e: imported('e'),
  }
  const once = assignImportSchedules(problems, TODAY)
  const twice = assignImportSchedules(once, TODAY)
  assert.deepEqual(twice, once)
})

// Regression: the original tracked record has firstSolvedAt set but
// nextRevisionAt null (popup migration pending). Its initialDueDay lands on
// DAY1, the same day imports want to start. The old code counted only records
// that ALREADY had nextRevisionAt, so imports filled DAY1 to 3 and the later
// migration write pushed it to 4 — the live-storage violation.
test('a pending-migration tracked record reserves its initialDueDay from imports', () => {
  // firstSolvedAt on TODAY morning → initialDueDay == DAY1.
  const pending = {
    problemId: 'original',
    title: 'original',
    url: 'https://leetcode.com/problems/original/',
    difficulty: 'Easy',
    firstSolvedAt: `${TODAY}T09:00:00.000Z`,
    lastAcceptedAt: `${TODAY}T09:00:00.000Z`,
    revisionHistory: [],
    nextRevisionAt: null, // not yet migrated
  }
  const problems = { original: pending, a: imported('a'), b: imported('b'), c: imported('c') }
  const out = assignImportSchedules(problems, TODAY)

  // The pending record itself is left untouched (not an import candidate).
  assert.equal(out.original.nextRevisionAt, null)

  // Model the popup migration write, then count total load: the migration
  // record plus its imports must not exceed the cap on DAY1.
  const afterMigration = { ...out, original: { ...pending, nextRevisionAt: DAY1 } }
  const day1 = Object.values(afterMigration).filter((r) => r.nextRevisionAt === DAY1)
  assert.equal(day1.length, IMPORT_CAP_PER_DAY)
  for (const [, ids] of Object.entries(totalByDay(afterMigration))) {
    assert.ok(ids.length <= IMPORT_CAP_PER_DAY)
  }
})

test('pending-migration records stack their initialDueDay load against imports', () => {
  // Three legacy records all migrating onto DAY1 → DAY1 is full.
  const problems = {}
  for (const s of ['l1', 'l2', 'l3']) {
    problems[s] = {
      problemId: s,
      title: s,
      url: `https://leetcode.com/problems/${s}/`,
      difficulty: 'Easy',
      firstSolvedAt: `${TODAY}T08:00:00.000Z`,
      lastAcceptedAt: `${TODAY}T08:00:00.000Z`,
      revisionHistory: [],
      nextRevisionAt: null,
    }
  }
  problems.a = imported('a')
  problems.b = imported('b')
  const out = assignImportSchedules(problems, TODAY)
  assert.equal(out.a.nextRevisionAt, addDays(DAY1, 1))
  assert.equal(out.b.nextRevisionAt, addDays(DAY1, 1))
})
