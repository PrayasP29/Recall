import test from 'node:test'
import assert from 'node:assert/strict'
import { isAcceptedEvent, isHistoryMerge } from './messageValidation.js'

test('accepted events require a valid problem payload', () => {
  const event = {
    problemId: 'two-sum',
    at: '2026-10-21T10:00:00.000Z',
    title: 'Two Sum',
    difficulty: 'Easy',
    topics: [],
  }
  assert.equal(isAcceptedEvent(event), true)
  assert.equal(isAcceptedEvent({ ...event, problemId: '__proto__' }), false)
  assert.equal(isAcceptedEvent({ ...event, at: 'not-a-date' }), false)
})

test('history merges require validated status and scheduling inputs', () => {
  const merge = {
    questions: [],
    importStatus: 'complete',
    totalNum: 0,
    todayDay: '2026-10-21',
  }
  assert.equal(isHistoryMerge(merge), true)
  assert.equal(isHistoryMerge({ ...merge, importStatus: 'error' }), false)
  assert.equal(isHistoryMerge({ ...merge, totalNum: -1 }), false)
})
