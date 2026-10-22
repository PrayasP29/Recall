import test from 'node:test'
import assert from 'node:assert/strict'
import { isRevisionSessionUrl, revisionSessionUrl } from './revisionSession.js'

test('revision session URLs are marked and validated explicitly', () => {
  const url = revisionSessionUrl('https://leetcode.com/problems/two-sum/')
  assert.equal(url, 'https://leetcode.com/problems/two-sum/?recallRevision=1')
  assert.equal(isRevisionSessionUrl(url), true)
  assert.equal(isRevisionSessionUrl('https://leetcode.com/problems/two-sum/'), false)
  assert.equal(isRevisionSessionUrl('not a URL'), false)
})

test('revision session marking preserves existing query parameters', () => {
  const url = revisionSessionUrl('https://leetcode.com/problems/two-sum/?tab=description')
  assert.equal(url, 'https://leetcode.com/problems/two-sum/?tab=description&recallRevision=1')
})
