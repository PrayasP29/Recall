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

// First revision is due three local calendar days after the first solve.
export function initialDueDay(firstSolvedAt) {
  return addDays(toLocalDay(new Date(firstSolvedAt)), 3)
}

// Legacy fixed-queue capacity retained for backwards-compatible migration and
// calendar helpers. The active popup uses dailySelection.js with two slots.
export const DAILY_REVIEW_CAP = 3

// The day a record already occupies. A legacy record without a stored date
// but with firstSolvedAt is about to be migrated to initialDueDay(firstSolvedAt),
// so it must reserve that day too.
export function scheduledDayOf(record) {
  if (record?.nextRevisionAt) return record.nextRevisionAt
  if (record?.firstSolvedAt) return initialDueDay(record.firstSolvedAt)
  return null
}

// Earliest day on/after startDay with fewer than `cap` scheduled records.
// `excludeId` keeps the record being scheduled from counting itself. Pure and
// deterministic: it only walks calendar days forward.
export function nextAvailableRevisionDay(
  problems,
  startDay,
  { cap = DAILY_REVIEW_CAP, excludeId = null } = {},
) {
  const load = {}
  for (const [id, record] of Object.entries(problems ?? {})) {
    if (id === excludeId) continue
    const day = scheduledDayOf(record)
    if (day) load[day] = (load[day] ?? 0) + 1
  }
  const limit = Math.max(1, cap)
  let day = startDay
  while ((load[day] ?? 0) >= limit) day = addDays(day, 1)
  return day
}

// Migrate records that predate the scheduler (nextRevisionAt null).
// No-op for records that already have a schedule or lack firstSolvedAt.
export function withInitialSchedule(record) {
  if (record.nextRevisionAt != null || !record.firstSolvedAt) return record
  return { ...record, nextRevisionAt: initialDueDay(record.firstSolvedAt) }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function validDay(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  return addDays(value, 0) === value && year >= 2000 && month >= 1 && month <= 12 && day >= 1 && day <= 31
}

// Repair legacy schedules without changing revision history. Known solve dates
// are authoritative for missing or 1970-era dates; ambiguous records remain
// unscheduled and are reported for manual recovery.
export function reconcileSchedules(problems) {
  const source = problems ?? {}
  const next = {}
  const load = {}
  const migrationIssues = []
  const entries = Object.entries(source).sort(([a], [b]) => a.localeCompare(b))

  const place = (record, requestedDay) => {
    let day = requestedDay
    while ((load[day] ?? 0) >= DAILY_REVIEW_CAP) day = addDays(day, 1)
    load[day] = (load[day] ?? 0) + 1
    return day
  }

  for (const [id, record] of entries) {
    let updated
    const storedDay = record.nextRevisionAt
    const invalidStoredDay = storedDay != null && !validDay(storedDay)
    const legacyDate = invalidStoredDay || (typeof storedDay === 'string' && storedDay.startsWith('1970-'))
    const historyDay = [...(record.revisionHistory ?? [])]
      .reverse()
      .map((entry) => entry?.nextRevisionAt)
      .find(validDay)
    const requestedDay = historyDay ?? (
      !record.revisionHistory?.length && record.firstSolvedAt
        ? initialDueDay(record.firstSolvedAt)
        : null
    )
    if ((storedDay == null || legacyDate) && requestedDay) {
      updated = { ...record, nextRevisionAt: place(record, requestedDay) }
    } else if (storedDay == null) {
      migrationIssues.push({ problemId: id, reason: 'missing firstSolvedAt and nextRevisionAt' })
      next[id] = record
      continue
    } else if (legacyDate) {
      migrationIssues.push({ problemId: id, reason: 'invalid nextRevisionAt with no reliable firstSolvedAt' })
      next[id] = record
      continue
    } else {
      updated = { ...record, nextRevisionAt: place(record, storedDay) }
    }
    next[id] = updated
  }

  return { problems: next, migrationIssues }
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
