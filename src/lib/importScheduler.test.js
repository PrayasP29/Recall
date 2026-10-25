import test from 'node:test'
import assert from 'node:assert/strict'
import { assignImportSchedules } from './importScheduler.js'

const TODAY = '2026-10-21'

const imported = (id, over = {}) => ({
  problemId: id,
  imported: true,
  firstSolvedAt: null,
  revisionHistory: [],
  nextRevisionAt: null,
  ...over,
})

test('historical imports become eligible on sync day without inventing solve timestamps', () => {
  const input = { a: imported('a'), b: imported('b') }
  const output = assignImportSchedules(input, TODAY)
  assert.equal(output.a.eligibilityDate, TODAY)
  assert.equal(output.b.eligibilityDate, TODAY)
  assert.equal(output.a.firstSolvedAt, null)
  assert.equal(output.b.firstSolvedAt, null)
})

test('a valid future eligibility date is preserved', () => {
  const input = { a: imported('a', { eligibilityDate: '2026-10-25', nextRevisionAt: '2026-10-25' }) }
  const output = assignImportSchedules(input, TODAY)
  assert.equal(output.a.eligibilityDate, '2026-10-25')
})

test('repeated history synchronization is idempotent', () => {
  const input = { a: imported('a') }
  const once = assignImportSchedules(input, TODAY)
  const twice = assignImportSchedules(once, TODAY)
  assert.deepEqual(twice, once)
})

test('non-imported records are not changed by import scheduling', () => {
  const record = { problemId: 'tracked', nextRevisionAt: '2026-10-25', revisionHistory: [] }
  const input = { tracked: record }
  assert.equal(assignImportSchedules(input, TODAY), input)
})
