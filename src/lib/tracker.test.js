import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyVerdict,
  slugFromPathname,
  normalizeProblemUrl,
  titleFromDocumentTitle,
  upsertProblem,
} from './tracker.js'

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
    'Pending',
    'Accepted solution pattern', // substring must not match
    '',
  ]) {
    assert.notEqual(classifyVerdict(t), 'accepted', t)
  }
  assert.equal(classifyVerdict('Wrong Answer'), 'rejected')
  assert.equal(classifyVerdict('Runtime Error'), 'rejected')
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
  at: '2026-10-20T10:00:00.000Z',
  ...over,
})

test('first accepted submission creates a complete record', () => {
  const rec = upsertProblem(undefined, ev())
  assert.deepEqual(rec, {
    problemId: 'two-sum',
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'Easy',
    firstSolvedAt: '2026-10-20T10:00:00.000Z',
    lastAcceptedAt: '2026-10-20T10:00:00.000Z',
    revisionHistory: [],
    nextRevisionAt: null,
  })
})

test('re-solving preserves firstSolvedAt and advances lastAcceptedAt', () => {
  const first = upsertProblem(undefined, ev())
  const again = upsertProblem(first, ev({ at: '2026-10-25T08:00:00.000Z' }))
  assert.equal(again.firstSolvedAt, '2026-10-20T10:00:00.000Z')
  assert.equal(again.lastAcceptedAt, '2026-10-25T08:00:00.000Z')
})

test('duplicate/replayed events never move lastAcceptedAt backwards or duplicate records', () => {
  const first = upsertProblem(undefined, ev())
  const replay = upsertProblem(first, ev({ at: '2026-10-19T00:00:00.000Z' })) // older timestamp
  assert.equal(replay.lastAcceptedAt, '2026-10-20T10:00:00.000Z')
  assert.equal(replay.problemId, first.problemId) // one record per problemId
})

test('missing metadata is backfilled by later sightings', () => {
  const sparse = upsertProblem(undefined, ev({ title: null, difficulty: null }))
  assert.equal(sparse.title, null)
  const filled = upsertProblem(sparse, ev({ at: '2026-10-21T00:00:00.000Z' }))
  assert.equal(filled.title, 'Two Sum')
  assert.equal(filled.difficulty, 'Easy')
  assert.equal(filled.firstSolvedAt, '2026-10-20T10:00:00.000Z')
})
