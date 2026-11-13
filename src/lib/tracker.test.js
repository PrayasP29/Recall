import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyVerdict,
  isSubmitElement,
  isSubmitShortcut,
  findVerdictInRecords,
  slugFromPathname,
  normalizeProblemUrl,
  titleFromDocumentTitle,
  upsertProblem,
  recordAccepted,
} from './tracker.js'

// Timestamps are built from LOCAL date components so tests are deterministic
// in any machine timezone (toLocalDay round-trips to the same calendar day).
const iso = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString()

test('Accepted result is recognized', () => {
  assert.equal(classifyVerdict('Accepted'), 'accepted')
  assert.equal(classifyVerdict('  Accepted \n'), 'accepted')
})

test('unsuccessful verdicts are ignored', () => {
  for (const t of [
    'Wrong Answer',
    'Runtime Error',
    'Time Limit Exceeded',
    'Memory Limit Exceeded',
    'Compile Error',
    'Compilation Error',
    'Pending',
    'Judging',
    'Accepted solution pattern', // substring must not match
    '',
  ]) {
    assert.notEqual(classifyVerdict(t), 'accepted', t)
  }
  assert.equal(classifyVerdict('Wrong Answer'), 'rejected')
  assert.equal(classifyVerdict('Runtime Error'), 'rejected')
  assert.equal(classifyVerdict('Compilation Error'), 'rejected')
  assert.equal(classifyVerdict('Pending'), null)
})

test('isSubmitElement identifies submit buttons and nested icons/spans', () => {
  // Mock element with closest and getAttribute
  function mockElement({ tag = 'BUTTON', text = '', attrs = {}, parent = null }) {
    const el = {
      tagName: tag,
      textContent: text,
      getAttribute(k) { return attrs[k] ?? null },
      parentElement: parent,
      closest(sel) {
        if (sel.includes('button') && el.tagName === 'BUTTON') return el
        if (attrs['data-e2e-locator']?.includes('submit') || attrs['data-cypress']?.includes('submit')) return el
        return parent ? parent.closest(sel) : null
      },
    }
    return el
  }

  // 1. Direct submit button
  const btn1 = mockElement({ tag: 'BUTTON', text: 'Submit' })
  assert.equal(isSubmitElement(btn1), true)

  // 2. Submit with shortcut in text
  const btn2 = mockElement({ tag: 'BUTTON', text: 'Submit (Ctrl + Enter)' })
  assert.equal(isSubmitElement(btn2), true)

  // 3. Nested path inside svg inside button
  const rootBtn = mockElement({ tag: 'BUTTON', attrs: { 'data-e2e-locator': 'console-submit-button' }, text: 'Submit' })
  const svg = mockElement({ tag: 'SVG', parent: rootBtn })
  const path = mockElement({ tag: 'PATH', parent: svg })
  assert.equal(isSubmitElement(path), true)

  // 4. Non-submit buttons
  const runBtn = mockElement({ tag: 'BUTTON', text: 'Run Code' })
  assert.equal(isSubmitElement(runBtn), false)

  const nullEl = null
  assert.equal(isSubmitElement(nullEl), false)
})

test('isSubmitShortcut detects Ctrl+Enter and Cmd+Enter', () => {
  assert.equal(isSubmitShortcut({ key: 'Enter', ctrlKey: true }), true)
  assert.equal(isSubmitShortcut({ key: 'Enter', metaKey: true }), true)
  assert.equal(isSubmitShortcut({ code: 'Enter', ctrlKey: true }), true)
  assert.equal(isSubmitShortcut({ key: 'Enter', ctrlKey: false, metaKey: false }), false)
  assert.equal(isSubmitShortcut({ key: 'a', ctrlKey: true }), false)
  assert.equal(isSubmitShortcut(null), false)
})

test('findVerdictInRecords accurately extracts verdict from DOM mutations', () => {
  // Case A: characterData mutation with Accepted
  const recA = [{ type: 'characterData', target: { textContent: 'Accepted' } }]
  assert.equal(findVerdictInRecords(recA), 'accepted')

  // Case B: addedNodes with text node 'Accepted'
  const textNode = { nodeType: 3, textContent: 'Accepted' }
  const recB = [{ type: 'childList', addedNodes: [textNode] }]
  assert.equal(findVerdictInRecords(recB), 'accepted')

  // Case C: addedNodes with submission-result element containing 'Accepted'
  const elemNode = {
    nodeType: 1,
    textContent: 'Accepted',
    getAttribute(k) { return k === 'data-e2e-locator' ? 'submission-result' : null },
  }
  const recC = [{ type: 'childList', addedNodes: [elemNode] }]
  assert.equal(findVerdictInRecords(recC), 'accepted')

  // Case D: addedNodes with Wrong Answer
  const recD = [{ type: 'characterData', target: { textContent: 'Wrong Answer' } }]
  assert.equal(findVerdictInRecords(recD), 'rejected')

  // Case E: Pending / Judging states return null
  const recE = [{ type: 'characterData', target: { textContent: 'Pending' } }]
  assert.equal(findVerdictInRecords(recE), null)
})

test('problem slugs come from every problem subpage, nowhere else', () => {
  assert.equal(slugFromPathname('/problems/two-sum/'), 'two-sum')
  assert.equal(slugFromPathname('/problems/two-sum/description/'), 'two-sum')
  assert.equal(slugFromPathname('/problems/two-sum/submissions/123/'), 'two-sum')
  assert.equal(slugFromPathname('/'), null)
  assert.equal(slugFromPathname('/problemset/'), null)
  assert.equal(slugFromPathname('/problems/'), null)
})

test('problem URLs normalize identically despite query/trailing-slash noise', () => {
  const a = normalizeProblemUrl(slugFromPathname('/problems/two-sum/'))
  const b = normalizeProblemUrl(slugFromPathname('/problems/two-sum/description/?tab=description'))
  const c = normalizeProblemUrl(slugFromPathname('/problems/two-sum/submissions/9/'))
  assert.equal(a, 'https://leetcode.com/problems/two-sum/')
  assert.equal(a, b)
  assert.equal(a, c)
})

test('document titles parse to bare problem titles', () => {
  assert.equal(titleFromDocumentTitle('1. Two Sum - LeetCode'), 'Two Sum')
  assert.equal(titleFromDocumentTitle('42. Trapping Rain Water | LeetCode'), 'Trapping Rain Water')
  assert.equal(titleFromDocumentTitle('Recall'), null)
  assert.equal(titleFromDocumentTitle(''), null)
})

const ev = (over = {}) => ({
  problemId: 'two-sum',
  url: normalizeProblemUrl('two-sum'),
  title: 'Two Sum',
  difficulty: 'Easy',
  at: iso(2026, 10, 20),
  ...over,
})

test('first accepted submission creates a complete record scheduled three days later', () => {
  const rec = upsertProblem(undefined, ev())
  assert.deepEqual(rec, {
    problemId: 'two-sum',
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'Easy',
    topics: [],
    firstSolvedAt: iso(2026, 10, 20),
    lastAcceptedAt: iso(2026, 10, 20),
    revisionHistory: [],
    eligibilityDate: '2026-10-23',
    nextRevisionAt: '2026-10-23', // three local calendar days later
  })
})

test('a solve with page tags stores normalized topics', () => {
  const rec = upsertProblem(undefined, ev({ topics: [{ name: 'Two Pointers' }, 'Array'] }))
  assert.deepEqual(rec.topics, ['Two Pointers', 'Array'])
})

test('a re-solve without tags preserves topics a sync already stored', () => {
  const first = { ...upsertProblem(undefined, ev()), topics: ['Two Pointers'] }
  const again = upsertProblem(first, ev({ at: iso(2026, 10, 25) })) // no topics in event
  assert.deepEqual(again.topics, ['Two Pointers'])
})

test('re-solving preserves firstSolvedAt and advances lastAcceptedAt', () => {
  const first = upsertProblem(undefined, ev())
  const again = upsertProblem(first, ev({ at: iso(2026, 10, 25) }))
  assert.equal(again.firstSolvedAt, iso(2026, 10, 20))
  assert.equal(again.lastAcceptedAt, iso(2026, 10, 25))
})

test('duplicate/replayed events never move lastAcceptedAt backwards or duplicate records', () => {
  const first = upsertProblem(undefined, ev())
  const replay = upsertProblem(first, ev({ at: iso(2026, 10, 19) })) // older timestamp
  assert.equal(replay.lastAcceptedAt, iso(2026, 10, 20))
  assert.equal(replay.problemId, first.problemId) // one record per problemId
})

test('missing metadata is backfilled by later sightings', () => {
  const sparse = upsertProblem(undefined, ev({ title: null, difficulty: null }))
  assert.equal(sparse.title, null)
  const filled = upsertProblem(sparse, ev({ at: iso(2026, 10, 21) }))
  assert.equal(filled.title, 'Two Sum')
  assert.equal(filled.difficulty, 'Easy')
  assert.equal(filled.firstSolvedAt, iso(2026, 10, 20))
})

test('re-solving preserves revision history and the revision schedule', () => {
  const history = [
    { reviewedAt: iso(2026, 10, 21, 9), result: 'remembered', nextRevisionAt: '2026-10-24' },
  ]
  const scheduled = { ...upsertProblem(undefined, ev()), revisionHistory: history, nextRevisionAt: '2026-10-24' }
  const reSolved = upsertProblem(scheduled, ev({ at: iso(2026, 10, 26) }))
  assert.deepEqual(reSolved.revisionHistory, history)
  assert.equal(reSolved.nextRevisionAt, '2026-10-24') // accepted ≠ revision; schedule untouched
})

test('legacy record with null nextRevisionAt is scheduled from firstSolvedAt', () => {
  const legacy = { ...upsertProblem(undefined, ev()), nextRevisionAt: null }
  const migrated = upsertProblem(legacy, ev({ at: iso(2026, 11, 2) }))
  assert.equal(migrated.nextRevisionAt, '2026-10-23') // from firstSolvedAt (Oct 20), not the re-solve
})

test('six solves on one day share the same three-day eligibility date', () => {
  let problems = {}
  for (let index = 0; index < 6; index++) {
    const problemId = `q${index}`
    const event = ev({
      problemId,
      url: normalizeProblemUrl(problemId),
      at: iso(2026, 10, 19),
    })
    problems = recordAccepted(problems, event)
  }

  const dueDays = Object.values(problems).map((record) => record.nextRevisionAt)
  assert.deepEqual(dueDays, Array(6).fill('2026-10-22'))
})

test('eligibility crosses year boundaries', () => {
  let problems = {}
  for (let index = 0; index < 6; index++) {
    const problemId = `q${index}`
    problems = recordAccepted(problems, ev({
      problemId,
      url: normalizeProblemUrl(problemId),
      at: iso(2026, 12, 31),
    }))
  }

  const dueDays = Object.values(problems).map((record) => record.nextRevisionAt)
  assert.deepEqual(dueDays, Array(6).fill('2027-01-03'))
})

test('new solves do not change existing eligibility dates', () => {
  const existing = Object.fromEntries(
    ['a', 'b', 'c'].map((problemId) => [
      problemId,
      { ...upsertProblem(undefined, ev({ problemId, url: normalizeProblemUrl(problemId) })), nextRevisionAt: '2026-10-23' },
    ]),
  )
  const next = recordAccepted(existing, ev({ problemId: 'new', url: normalizeProblemUrl('new'), at: iso(2026, 10, 20) }))
  assert.equal(next.new.nextRevisionAt, '2026-10-23')
  assert.equal(next.a.nextRevisionAt, '2026-10-23')
})

test('recordAccepted never moves an existing stored schedule', () => {
  const scheduled = { ...upsertProblem(undefined, ev()), nextRevisionAt: '2026-10-24' }
  const next = recordAccepted({ 'two-sum': scheduled }, ev({ at: iso(2026, 10, 26) }))
  assert.equal(next['two-sum'].nextRevisionAt, '2026-10-24')
  assert.equal(next['two-sum'].lastAcceptedAt, iso(2026, 10, 26))
})

test('a pending imported record gets a real date from the accepted event, not 1970', () => {
  const imported = {
    problemId: 'two-sum',
    url: normalizeProblemUrl('two-sum'),
    title: null,
    difficulty: null,
    topics: [],
    firstSolvedAt: null,
    lastAcceptedAt: null,
    revisionHistory: [],
    nextRevisionAt: null,
    imported: true,
  }
  const next = recordAccepted({ 'two-sum': imported }, ev({ at: iso(2026, 10, 20) }))
  assert.equal(next['two-sum'].firstSolvedAt, iso(2026, 10, 20))
  assert.equal(next['two-sum'].nextRevisionAt, '2026-10-23')
})
