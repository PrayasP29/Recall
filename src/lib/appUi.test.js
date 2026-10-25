import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')

test('daily cards keep Open and no longer render recall feedback buttons', () => {
  assert.match(appSource, /<ProblemLink rec=\{rec\} revision \/>/)
  assert.doesNotMatch(appSource, /Remembered|Forgotten|RECALL_REVIEW_PROBLEM|onReview/)
})
