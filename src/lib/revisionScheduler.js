// Pure revision-scheduling logic — no DOM, no chrome.*.
//
// Date representation:
//   - INSTANTS (firstSolvedAt, lastAcceptedAt, reviewedAt) are ISO strings.
//   - CALENDAR DAYS (nextRevisionAt, "today") are LOCAL-day strings
//     'YYYY-MM-DD' — the user's wall-clock date, never a UTC day.
// Day arithmetic is done with pure UTC Gregorian math, so it never
// involves a timezone at all.

const pad = (n) => String(n).padStart(2, '0')

// Local calendar day of an instant, per the user's system clock.
export function toLocalDay(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Pure Gregorian day arithmetic on 'YYYY-MM-DD' strings.
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number)
  // Date.UTC rolls over month/year/leap boundaries correctly.
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

// Interval after the Nth consecutive 'remembered' review (1-based).
export const REMEMBERED_INTERVALS = [3, 7, 14, 30]

// Consecutive trailing 'remembered' reviews in the history.
function trailingStreak(history) {
  let n = 0
  for (let i = history.length - 1; i >= 0 && history[i].result === 'remembered'; i--) n++
  return n
}

// First revision is due the calendar day after the first solve.
export function initialDueDay(firstSolvedAt) {
  return addDays(toLocalDay(new Date(firstSolvedAt)), 1)
}

// Migrate records that predate the scheduler (nextRevisionAt null).
// No-op for records that already have a schedule or lack firstSolvedAt.
export function withInitialSchedule(record) {
  if (record.nextRevisionAt != null || !record.firstSolvedAt) return record
  return { ...record, nextRevisionAt: initialDueDay(record.firstSolvedAt) }
}

// Record one explicit revision attempt (never call on page open).
//   remembered: +3 / +7 / +14 / +30 days by consecutive-streak position
//   forgotten:  +1 day, streak resets
// Returns the SAME record object if this reviewedAt was already recorded
// (double-click / replay guard) — callers can compare by identity.
export function applyRevision(record, result, reviewedAt = new Date().toISOString()) {
  const history = record.revisionHistory ?? []
  if (history.some((h) => h.reviewedAt === reviewedAt)) return record
  const streak = trailingStreak([...history, { result }])
  const days = result === 'remembered' ? REMEMBERED_INTERVALS[Math.min(streak, 4) - 1] : 1
  const nextRevisionAt = addDays(toLocalDay(new Date(reviewedAt)), days)
  return {
    ...record,
    revisionHistory: [...history, { reviewedAt, result, nextRevisionAt }],
    nextRevisionAt,
  }
}

// A revision is actionable iff it is due today or overdue (never early).
export function isDue(record, todayDay) {
  return Boolean(record.nextRevisionAt && record.nextRevisionAt <= todayDay)
}

// Due today or overdue, oldest due date first. Records with a null
// nextRevisionAt never appear — run withInitialSchedule first.
export function dueProblems(problems, todayDay) {
  return Object.values(problems ?? {})
    .filter((r) => isDue(r, todayDay))
    .sort((a, b) => (a.nextRevisionAt < b.nextRevisionAt ? -1 : 1))
}

// { 'YYYY-MM-DD': { solved: [record], revisions: [record] } } for one month.
// month is 0-based, like Date. Days outside the month are ignored, so
// year boundaries and leap years fall out of the day-string comparison.
export function calendarEvents(problems, year, month) {
  const prefix = `${year}-${pad(month + 1)}-`
  const events = {}
  const put = (day, kind, record) => {
    if (!day.startsWith(prefix)) return
    ;(events[day] ??= { solved: [], revisions: [] })[kind].push(record)
  }
  for (const record of Object.values(problems ?? {})) {
    if (record.firstSolvedAt) put(toLocalDay(new Date(record.firstSolvedAt)), 'solved', record)
    if (record.nextRevisionAt) put(record.nextRevisionAt, 'revisions', record)
  }
  return events
}
