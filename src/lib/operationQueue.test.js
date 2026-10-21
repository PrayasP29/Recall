import test from 'node:test'
import assert from 'node:assert/strict'
import { enqueueOperation } from './operationQueue.js'

test('a failed queued operation does not poison later operations', async () => {
  const state = { current: Promise.resolve() }
  const failed = enqueueOperation(state, async () => {
    throw new Error('expected failure')
  })
  const later = enqueueOperation(state, async () => 'completed')

  await assert.rejects(failed, /expected failure/)
  assert.equal(await later, 'completed')
})

test('serialized read-modify-write operations retain both updates', async () => {
  const state = { current: Promise.resolve() }
  let problems = {}
  const imported = enqueueOperation(state, async () => {
    await new Promise((resolve) => setTimeout(resolve, 1))
    problems = { ...problems, imported: { problemId: 'imported' } }
  })
  const accepted = enqueueOperation(state, async () => {
    problems = { ...problems, accepted: { problemId: 'accepted' } }
  })

  await Promise.all([imported, accepted])
  assert.deepEqual(Object.keys(problems).sort(), ['accepted', 'imported'])
})
