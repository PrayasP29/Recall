import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureDailySelection, initializeEligibility } from './dailySelection.js'
import { historySyncResponse, historySyncState } from './historySync.js'

const DAY = '2026-10-26'

function record(problemId, eligibilityDate = DAY) {
  return {
    problemId,
    title: problemId,
    eligibilityDate,
    revisionHistory: [],
  }
}

function fixedRandom(...values) {
  let index = 0
  return () => values[index++] ?? values.at(-1) ?? 0
}

function mergedState(problems, dailySelections = { [DAY]: [] }) {
  const { problems: initialized } = initializeEligibility(problems, DAY)
  return {
    problems: initialized,
    ...ensureDailySelection(initialized, dailySelections, DAY, fixedRandom(0, 0)),
  }
}

test('history sync forwards the background-generated selection and popup applies it', () => {
  const problems = Object.fromEntries(
    Array.from({ length: 195 }, (_, index) => {
      const problemId = `problem-${index}`
      return [problemId, record(problemId)]
    }),
  )
  const merged = mergedState(problems)
  const response = historySyncResponse({
    importStatus: 'complete',
    totalNum: 195,
    stats: { discovered: 195, added: 195, matched: 0, skipped: 0 },
    problems: merged.problems,
    selection: merged.selection,
  })

  assert.equal(response.status, 'complete')
  assert.equal(response.selection.length, 2)
  assert.deepEqual(merged.dailySelections[DAY], response.selection)
  assert.deepEqual(historySyncState(response), {
    problems: merged.problems,
    selection: merged.selection,
  })
  assert.ok(response.selection.every((id) => response.problems[id].eligibilityDate <= DAY))
})

test('partial history sync also updates the popup selection', () => {
  const merged = mergedState({
    a: record('a'),
    b: record('b'),
    future: record('future', '2026-10-27'),
  })
  const response = historySyncResponse({
    importStatus: 'partial',
    totalNum: 3,
    stats: { discovered: 2, added: 2, matched: 0, skipped: 1 },
    problems: merged.problems,
    selection: merged.selection,
  })

  assert.equal(historySyncState(response).selection.length, 2)
})

test('failed sync does not produce popup state or clear the current selection', () => {
  assert.equal(historySyncState({ status: 'error', message: 'network failed' }), null)
  assert.equal(historySyncState({ status: 'complete', problems: {}, selection: undefined }), null)
})

test('empty eligible pools keep an empty selection through the response contract', () => {
  const merged = mergedState({ future: record('future', '2026-10-27') })
  const response = historySyncResponse({
    importStatus: 'complete',
    totalNum: 1,
    stats: { discovered: 1, added: 1, matched: 0, skipped: 0 },
    problems: merged.problems,
    selection: merged.selection,
  })

  assert.deepEqual(response.selection, [])
  assert.deepEqual(historySyncState(response).selection, [])
})

test('a non-empty persisted selection remains unchanged after sync', () => {
  const existing = ['b', 'a']
  const merged = mergedState({
    a: record('a'),
    b: record('b'),
    c: record('c'),
  }, { [DAY]: existing })
  const response = historySyncResponse({
    importStatus: 'complete',
    totalNum: 3,
    stats: { discovered: 3, added: 0, matched: 3, skipped: 0 },
    problems: merged.problems,
    selection: merged.selection,
  })

  assert.deepEqual(response.selection, existing)
  assert.deepEqual(historySyncState(response).selection, existing)
})
