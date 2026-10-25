import { addDays } from './revisionScheduler.js'
import { OTHER, patternTopic, dueOrder } from './patterns.js'

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

function candidateViews(records, day, today, weeklyReviewDay) {
  const scheduled = candidatesForDay(records, day, weeklyReviewDay)
  if (day === today || day === weeklyReviewDay) {
    return {
      scheduled: records.filter((record) => record.nextRevisionAt && record.nextRevisionAt <= day),
      pending: [],
    }
  }
  return { scheduled, pending: [] }
}

export function buildPracticeSchedule(problems, today) {
  const records = Object.values(problems ?? {})
  const monday = nextWeekStart(today)
  const assignments = {}
  const assigned = new Set()
  for (let offset = 0; offset < PRACTICE_DAYS; offset++) {
    const day = addDays(today, offset)
    const views = candidateViews(records, day, today, monday)
    const scheduled = views.scheduled.filter((record) => !assigned.has(record.problemId))
    const pending = views.pending.filter((record) => !assigned.has(record.problemId))
    const candidates = [...scheduled, ...pending]
    const selected = dueOrder(candidates).slice(0, PRACTICE_CAP)
    const selectedTopics = new Set(selected.map((record) => patternTopic(record)).filter(Boolean))
    const selectedTopic = selectedTopics.size === 1 ? [...selectedTopics][0] : null
    selected.forEach((record) => assigned.add(record.problemId))
    assignments[day] = {
      date: day,
      // No usable pattern means generic/untagged questions. The README calls
      // this group Other; without it those questions were invisible.
      topic: selectedTopic ?? (selected.length ? OTHER : null),
      problemIds: selected.map((record) => record.problemId),
      plannedDates: Object.fromEntries(
        selected
          .filter((record) => record.plannedDate)
          .map((record) => [record.problemId, record.plannedDate]),
      ),
      weeklyOverdueReview: day === monday,
    }
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
