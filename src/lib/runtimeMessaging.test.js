import test from 'node:test'
import assert from 'node:assert/strict'
import { sendExtensionMessage } from './runtimeMessaging.js'

const acceptedMessage = {
  type: 'RECALL_RECORD_ACCEPTED',
  event: {
    problemId: 'merge-k-sorted-lists',
    at: '2026-10-21T16:25:00.000Z',
    title: 'Merge k Sorted Lists',
    difficulty: 'Hard',
    topics: [],
  },
}

test('accepted tracking sends the message through runtime without storage access', async () => {
  const calls = []
  const runtime = {
    sendMessage(message, callback) {
      calls.push(message)
      callback({ status: 'ok', problems: {} })
    },
  }

  const response = await sendExtensionMessage(runtime, acceptedMessage)

  assert.deepEqual(calls, [acceptedMessage])
  assert.deepEqual(response, { status: 'ok', problems: {} })
})

test('a successful background response is returned to the content path', async () => {
  const response = await sendExtensionMessage(
    {
      sendMessage(_message, callback) {
        callback({ status: 'ok' })
      },
    },
    acceptedMessage,
  )

  assert.equal(response.status, 'ok')
})

test('runtime lastError is reported when the background request fails', async () => {
  const runtime = {
    lastError: { message: 'Could not establish connection. Receiving end does not exist.' },
    sendMessage(_message, callback) {
      callback(undefined)
    },
  }

  await assert.rejects(
    sendExtensionMessage(runtime, acceptedMessage),
    /Could not establish connection/,
  )
})

test('a missing background response is returned for explicit status handling', async () => {
  const response = await sendExtensionMessage(
    {
      sendMessage(_message, callback) {
        callback(undefined)
      },
    },
    acceptedMessage,
  )

  assert.equal(response, undefined)
})

test('a rejected background response remains a failure', async () => {
  const response = await sendExtensionMessage(
    {
      sendMessage(_message, callback) {
        callback({ status: 'error', message: 'Storage operation failed.' })
      },
    },
    acceptedMessage,
  )

  assert.equal(response.status, 'error')
  assert.equal(response.message, 'Storage operation failed.')
})
