// Pattern grouping — pure, no DOM, no chrome.*. Turns a day's problem list
// into deterministic topic groups for the existing daily queue. It only
// reorders and labels records; it never touches dates or revision history.

// Tags that describe a data structure/problem shape rather than a technique,
// so they make poor daily-practice headings. Overridable; kept tiny on
// purpose — LeetCode can add new tags and they work without code changes.
export const GENERIC_TOPICS = new Set(['Array', 'Hash Table', 'String', 'Math'])

// Coerce arbitrary stored metadata to a clean list of non-empty unique
// strings. Any missing/malformed shape becomes [] (never throws).
export function normalizeTopics(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const t of value) {
    const name = typeof t === 'string' ? t.trim() : typeof t?.name === 'string' ? t.name.trim() : ''
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

// Topic heading for a real DSA pattern, or null when the record only has
// generic tags (Array/Hash Table/...) or none — those are not a pattern.
export function patternTopic(record, generic = GENERIC_TOPICS) {
  const topics = normalizeTopics(record?.topics).sort()
  return topics.find((t) => !generic.has(t)) ?? null
}

// One deterministic heading per problem: the alphabetically-first non-generic
// topic, else the alphabetically-first topic, else null ("Other"). Sorting
// first makes the choice stable even if the source tag order is not.
export function primaryTopic(record, generic = GENERIC_TOPICS) {
  const topics = normalizeTopics(record?.topics).sort()
  const pick = topics.find((t) => !generic.has(t)) ?? topics[0]
  return pick ?? null
}

export const OTHER = 'Other'

// Oldest-due-first, slug tie-break — the one ordering every section uses.
export function dueOrder(list) {
  return [...list].sort((a, b) => {
    if (a.nextRevisionAt !== b.nextRevisionAt) return a.nextRevisionAt < b.nextRevisionAt ? -1 : 1
    const ak = a.problemId ?? ''
    const bk = b.problemId ?? ''
    return ak < bk ? -1 : ak > bk ? 1 : 0
  })
}

// Deterministic focus pattern for a day, derived purely from that day's
// due+overdue list (the caller filters). `day` is the viewed 'YYYY-MM-DD'.
// Rank: patterns with overdue work, then larger groups, then name A→Z.
// Returns the winning topic name, or null when no real pattern is due.
export function selectDailyPattern(dueList, day, generic = GENERIC_TOPICS) {
  const groups = new Map()
  for (const rec of dueList ?? []) {
    const topic = patternTopic(rec, generic)
    if (!topic) continue // "Other"/generic-only is not a DSA pattern
    if (!groups.has(topic)) groups.set(topic, [])
    groups.get(topic).push(rec)
  }
  if (!groups.size) return null
  const hasOverdue = (recs) => recs.some((r) => r.nextRevisionAt < day)
  return [...groups.entries()].sort(([a, ar], [b, br]) => {
    if (hasOverdue(ar) !== hasOverdue(br)) return hasOverdue(ar) ? -1 : 1
    if (ar.length !== br.length) return br.length - ar.length
    return a < b ? -1 : a > b ? 1 : 0
  })[0][0]
}

// Build the day's display plan. Returns { focusTopic, focus, overdue, other }
// where `focus` is capped at `max`. Rules: focus-topic records fill focus;
// untagged records go to `other`; a due record from a *non-focus* pattern is
// shown in `overdue` only when it is actually overdue (otherwise it waits for
// its own day). Pure — same input, same output.
// ponytail: at most max focus cards, selection derived fresh each render (not
// persisted). If repeats become annoying, persist {day, pattern} and exclude it.
export function dayPlan(problems, day, max = 3, generic = GENERIC_TOPICS) {
  const dueList = (problems ?? []).filter((r) => r.nextRevisionAt && r.nextRevisionAt <= day)
  const focusTopic = selectDailyPattern(dueList, day, generic)
  const focus = []
  const overdue = []
  const other = []
  for (const rec of dueOrder(dueList)) {
    const topic = patternTopic(rec, generic)
    if (!topic) other.push(rec) // untagged or generic-only: not a pattern
    else if (topic === focusTopic && focus.length < max) focus.push(rec)
    else if (rec.nextRevisionAt < day) overdue.push(rec) // overdue, different pattern
    // non-focus, not overdue → waits for its own day
  }
  return { focusTopic, focus, overdue, other }
}

// Group a day's list into [topic, records[]] pairs, headings alphabetical
// with "Other" last. Records keep their incoming order (oldest-due-first);
// ties are broken by slug so the whole thing is stable across reopen/restart.
export function groupByTopic(list, generic = GENERIC_TOPICS) {
  const groups = new Map()
  for (const rec of dueOrder(list)) {
    const key = primaryTopic(rec, generic) ?? OTHER
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(rec)
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === OTHER) return 1
    if (b === OTHER) return -1
    return a < b ? -1 : a > b ? 1 : 0
  })
}
