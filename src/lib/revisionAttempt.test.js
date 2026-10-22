import test from 'node:test'
import assert from 'node:assert/strict'
import { canSafelyResetEditor, freshAttemptFallback } from './revisionAttempt.js'

test('fresh attempt requires the verified native reset control', () => {
  assert.equal(canSafelyResetEditor, 'native-control')
  assert.deepEqual(freshAttemptFallback(), {
    status: 'requires-native-control',
    editorChanged: false,
    automaticSubmission: false,
    otherLanguageDraftsPreserved: true,
    acceptedSubmissionsPreserved: true,
  })
})
