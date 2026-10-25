import { eligibilityDateOf } from './dailySelection.js'

// Imported history has no verified solve timestamp. It becomes eligible on
// the sync date unless an existing valid future eligibility date is retained.
export function assignImportSchedules(problems, todayDay) {
  const all = problems ?? {}
  const next = { ...all }
  let changed = false
  for (const record of Object.values(all)) {
    if (record.imported !== true || record.eligibilityDate) continue
    const existing = eligibilityDateOf(record)
    const eligibilityDate = existing && existing > todayDay ? existing : todayDay
    next[record.problemId] = { ...record, eligibilityDate }
    changed = true
  }
  return changed ? next : problems
}
