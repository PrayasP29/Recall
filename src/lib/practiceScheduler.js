import { addDays } from './revisionScheduler.js'
import { patternTopic, dueOrder, selectDailyPattern } from './patterns.js'

export const PRACTICE_DAYS = 7
export const PRACTICE_CAP = 3

function dayOfWeek(day) {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay()
}

export function weekStart(day) {
  const weekday = dayOfWeek(day)
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday
  return addDays(day, mondayOffset)
}

export function nextWeekStart(day) {
  const weekday = dayOfWeek(day)
  const mondayOffset = weekday === 1 ? 0 : weekday === 0 ? 1 : 8 - weekday
  return addDays(day, mondayOffset)
}

function candidatesForDay(records, day, weeklyReviewDay) {
  if (day === weeklyReviewDay) {
    return records.filter((record) => record.nextRevisionAt && record.nextRevisionAt <= day)
  }
  return records.filter((record) => record.nextRevisionAt === day)
}

function isPendingImport(record) {
  return record.imported === true && !record.nextRevisionAt && !(record.revisionHistory?.length)
}

function candidateViews(records, day, today, weeklyReviewDay) {
  const scheduled = candidatesForDay(records, day, weeklyReviewDay)
  if (day === today || day === weeklyReviewDay) return { scheduled, pending: [] }
  const pending = records
    .filter(isPendingImport)
    .map((record) => ({ ...record, nextRevisionAt: day, plannedDate: day }))
  return { scheduled, pending }
}

function choosePattern(records, day, previousTopic, weeklyReview) {
  const topics = new Set(records.map((record) => patternTopic(record)).filter(Boolean))
  if (!topics.size) return { topic: null, reason: 'no usable DSA pattern candidates', baseTopic: null }
  let selected
  let baseTopic
  if (weeklyReview) {
    const oldestDue = [...records]
      .filter((record) => record.nextRevisionAt)
      .sort((a, b) => a.nextRevisionAt.localeCompare(b.nextRevisionAt) || a.problemId.localeCompare(b.problemId))[0]
      ?.nextRevisionAt
    const oldestTopics = [...topics].filter((topic) =>
      records.some((record) => patternTopic(record) === topic && record.nextRevisionAt === oldestDue),
    )
    selected = oldestTopics.sort()[0] ?? [...topics].sort()[0]
    baseTopic = selected
  } else {
    selected = selectDailyPattern(records, day)
    baseTopic = selected
  }
  if (selected !== previousTopic || topics.size === 1) {
    return {
      topic: selected,
      baseTopic,
      reason: weeklyReview
        ? 'oldest overdue pattern selected'
        : 'normal pattern ranking selected',
    }
  }
  const candidateCounts = new Map(
    [...topics].map((topic) => [
      topic,
      records.filter((record) => patternTopic(record) === topic).length,
    ]),
  )
  const selectedCount = candidateCounts.get(selected) ?? 0
  const alternative = [...topics]
    .filter((topic) => topic !== previousTopic && (candidateCounts.get(topic) ?? 0) >= selectedCount)
    .sort()
  const alternativeTopic = alternative[0] ?? selected
  return {
    topic: alternativeTopic,
    baseTopic,
    reason: alternativeTopic === selected
      ? 'previous pattern retained because alternatives cannot fill more capacity'
      : 'previous pattern avoided; strongest alternative selected',
  }
}

export function buildPracticeSchedule(problems, today) {
  const records = Object.values(problems ?? {})
  const monday = nextWeekStart(today)
  const assignments = {}
  const assigned = new Set()
  let previousTopic = null
  for (let offset = 0; offset < PRACTICE_DAYS; offset++) {
    const day = addDays(today, offset)
    const views = candidateViews(records, day, today, monday)
    const scheduled = views.scheduled.filter((record) => !assigned.has(record.problemId))
    const pending = views.pending.filter((record) => !assigned.has(record.problemId))
    const candidates = [...scheduled, ...pending]
    const choice = choosePattern(
      scheduled.length ? scheduled : candidates,
      day,
      previousTopic,
      day === monday,
    )
    const selected = choice.topic
      ? dueOrder(candidates.filter((record) => patternTopic(record) === choice.topic)).slice(0, PRACTICE_CAP)
      : []
    selected.forEach((record) => assigned.add(record.problemId))
    assignments[day] = {
      date: day,
      topic: choice.topic,
      problemIds: selected.map((record) => record.problemId),
      plannedDates: Object.fromEntries(
        selected
          .filter((record) => record.plannedDate)
          .map((record) => [record.problemId, record.plannedDate]),
      ),
      weeklyOverdueReview: day === monday,
    }
    if (choice.topic) previousTopic = choice.topic
  }

  const backlog = records.filter((record) =>
    record.nextRevisionAt &&
    record.nextRevisionAt <= monday &&
    !assigned.has(record.problemId),
  )

  const result = {
    today,
    weekStart: monday,
    assignments,
    backlog,
  }
  return result
}

export function plannedRecords(problems, assignment) {
  const records = problems ?? {}
  return (assignment?.problemIds ?? [])
    .map((problemId) => records[problemId])
    .filter(Boolean)
    .map((record) => {
      const plannedDate = assignment?.plannedDates?.[record.problemId]
      return plannedDate ? { ...record, nextRevisionAt: plannedDate } : record
    })
}
