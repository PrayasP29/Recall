// Import scheduling — pure, no DOM, no chrome.*.
//
// Imported problems get their FIRST revision date here, not from
// initialDueDay(): historical solves would otherwise be overdue on day one.
// Remembered/Forgotten behaviour after that is untouched.
import { addDays, initialDueDay } from './revisionScheduler.js'

// Daily revision load cap: existing scheduled revisions + newly imported
// problems. A day that already has 2 revisions accepts 1 import; a day with
// 3+ accepts none. This keeps imports from stacking on a busy queue.
export const IMPORT_CAP_PER_DAY = 3

// The day a record will occupy: its existing schedule, or (for a legacy
// record the popup's withInitialSchedule migration is about to schedule)
// initialDueDay(firstSolvedAt). Counting only the former let the migration
// write push a day to 4 after imports were already placed on it.
function occupiedDay(rec) {
  if (rec.nextRevisionAt) return rec.nextRevisionAt
  if (rec.firstSolvedAt) return initialDueDay(rec.firstSolvedAt)
  return null
}

// Schedules only records explicitly marked `imported: true` that have no
// nextRevisionAt and no revision history. All other records (including
// already-scheduled imports and normal tracked problems) are left untouched,
// so repeated syncs never reschedule anything.
export function assignImportSchedules(problems, todayDay) {
  const all = problems ?? {}
  const existingLoad = {}
  for (const rec of Object.values(all)) {
    // Do NOT count an unscheduled import twice: it has firstSolvedAt null, so
    // occupiedDay() returns null for it and only pre-existing/tracked records
    // reserve a slot here.
    const day = occupiedDay(rec)
    if (day) existingLoad[day] = (existingLoad[day] ?? 0) + 1
  }

  // Deterministic order: slug ascending. Object insertion order never matters.
  const pending = Object.values(all)
    .filter((r) => r.imported === true && !r.nextRevisionAt && !(r.revisionHistory?.length))
    .sort((a, b) => (a.problemId < b.problemId ? -1 : a.problemId > b.problemId ? 1 : 0))
  if (!pending.length) return problems

  const next = { ...all }
  let day = addDays(todayDay, 1) // imports start tomorrow, never today
  let used = 0 // imports placed on `day`
  for (const rec of pending) {
    // ponytail: total daily load <= 3, so busy existing days delay imports
    // instead of being overwritten. If "max 3 new imports regardless of load"
    // is wanted instead, drop the existingLoad term below.
    while (used + (existingLoad[day] ?? 0) >= IMPORT_CAP_PER_DAY) {
      day = addDays(day, 1)
      used = 0
    }
    next[rec.problemId] = { ...rec, nextRevisionAt: day }
    used++
  }
  return next
}
