import { addDays, initialDueDay } from './revisionScheduler.js'

export const DAILY_SELECTION_SIZE = 2
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function validDay(day) {
  return typeof day === 'string' && DAY_RE.test(day) && addDays(day, 0) === day
}

function randomIndex(random, length) {
  const value = Number(random())
  const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999999) : 0
  return Math.floor(normalized * length)
}

function chooseDistinct(records, count, random) {
  const pool = [...records]
  const chosen = []
  while (pool.length && chosen.length < count) {
    chosen.push(pool.splice(randomIndex(random, pool.length), 1)[0])
  }
  return chosen
}

function selectionIds(selections, day) {
  const value = selections?.[day]
  return Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === 'string'))] : []
}

function recentSelectionIds(selections, day) {
  const ids = new Set()
  for (let offset = 1; offset <= 7; offset++) {
    for (const id of selectionIds(selections, addDays(day, -offset))) ids.add(id)
  }
  return ids
}

export function eligibilityDateOf(record) {
  if (validDay(record?.eligibilityDate)) return record.eligibilityDate
  if (validDay(record?.nextRevisionAt)) return record.nextRevisionAt
  if (record?.firstSolvedAt && Number.isFinite(Date.parse(record.firstSolvedAt))) {
    return initialDueDay(record.firstSolvedAt)
  }
  return null
}

export function isEligible(record, day) {
  const eligibilityDate = eligibilityDateOf(record)
  return Boolean(eligibilityDate && validDay(day) && eligibilityDate <= day)
}

export function selectDailyQuestions(
  problems,
  selections,
  day,
  random = Math.random,
) {
  const existing = selectionIds(selections, day)
  if (existing.length) return existing.slice(0, DAILY_SELECTION_SIZE)

  const records = Object.values(problems ?? {})
    .filter((record) => record?.problemId && isEligible(record, day))
  const recent = recentSelectionIds(selections, day)
  const preferred = records.filter((record) => !recent.has(record.problemId))
  const candidates = preferred.length >= DAILY_SELECTION_SIZE ? preferred : records
  const selected = chooseDistinct(candidates, DAILY_SELECTION_SIZE, random)
    .map((record) => record.problemId)

  return selected
}

export function persistDailySelection(selections, day, problemIds) {
  return {
    ...(selections ?? {}),
    [day]: [...new Set(problemIds)].slice(0, DAILY_SELECTION_SIZE),
  }
}

export function ensureDailySelection(problems, selections, day, random = Math.random) {
  const selection = selectDailyQuestions(problems, selections, day, random)
  const current = selections?.[day]
  const hasNonEmptySelection = Array.isArray(current) && current.length > 0
  return {
    selection,
    dailySelections: hasNonEmptySelection
      ? selections
      : persistDailySelection(selections, day, selection),
  }
}

export function initializeEligibility(problems, todayDay) {
  const next = {}
  const migrationIssues = []
  for (const [id, record] of Object.entries(problems ?? {})) {
    const current = record?.eligibilityDate
    if (validDay(current)) {
      next[id] = record
      continue
    }

    const legacy = validDay(record?.nextRevisionAt) ? record.nextRevisionAt : null
    const historyDate = [...(record?.revisionHistory ?? [])]
      .reverse()
      .map((entry) => entry?.nextRevisionAt)
      .find(validDay)
    const solveDate = record?.firstSolvedAt && Number.isFinite(Date.parse(record.firstSolvedAt))
      ? initialDueDay(record.firstSolvedAt)
      : null
    const recovered = historyDate ?? legacy ?? solveDate
    const eligibilityDate = recovered && recovered > todayDay
      ? recovered
      : recovered
        ? todayDay
        : record?.imported === true
          ? todayDay
          : null

    if (record?.nextRevisionAt && !legacy && !historyDate && !solveDate) {
      migrationIssues.push({
        problemId: id,
        reason: 'invalid legacy schedule left unchanged; manual schedule recovery required',
      })
    } else if (!record?.firstSolvedAt && !legacy && !historyDate && !record?.imported) {
      migrationIssues.push({
        problemId: id,
        reason: 'ambiguous legacy record left unchanged; manual schedule recovery required',
      })
    } else if (!record?.firstSolvedAt && !legacy && !historyDate) {
      migrationIssues.push({
        problemId: id,
        reason: 'missing solve date; imported record made eligible today by recovery policy',
      })
    }

    next[id] = eligibilityDate ? { ...record, eligibilityDate } : record
  }
  return { problems: next, migrationIssues }
}
