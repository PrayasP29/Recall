// Pure tracking logic — no DOM, no chrome.* — so it can be unit tested with node:test.
import { initialDueDay } from './revisionScheduler.js'
import { normalizeTopics } from './patterns.js'

// Verdict strings observed in LeetCode's submission result panel
// (evidence: LeetUp extension uses this exact-text approach).
const ACCEPTED_TEXT = 'Accepted'

const REJECTED_TEXT = new Set([
  'Wrong Answer',
  'Time Limit Exceeded',
  'Runtime Error',
  'Memory Limit Exceeded',
  'Compile Error',
  'Output Limit Exceeded',
])

// 'accepted' | 'rejected' | null. Exact trimmed match only — a colored
// element or substring ("Accepted solution pattern") never classifies.
export function classifyVerdict(text) {
  const t = typeof text === 'string' ? text.trim() : ''
  if (t === ACCEPTED_TEXT) return 'accepted'
  if (REJECTED_TEXT.has(t)) return 'rejected'
  return null
}

// 'two-sum' for /problems/two-sum/, /problems/two-sum/description/,
// /problems/two-sum/submissions/123/ — null anywhere else.
export function slugFromPathname(pathname) {
  const m = /^\/problems\/([^/?#]+)/.exec(pathname || '')
  return m ? m[1] : null
}

// Query params and trailing slashes must never create duplicate records.
export function normalizeProblemUrl(slug) {
  return `https://leetcode.com/problems/${slug}/`
}

// "1. Two Sum - LeetCode" -> "Two Sum"; null when pattern absent.
export function titleFromDocumentTitle(docTitle) {
  const m = /^\d+\.\s*(.+?)(?:\s*[-|]\s*LeetCode)?\s*$/.exec(docTitle || '')
  return m ? m[1] : null
}

// One record per problem. First accepted submission creates it; later
// accepts keep firstSolvedAt and only move lastAcceptedAt forward.
// Missing title/difficulty get backfilled when later sightings provide them.
export function upsertProblem(existing, event) {
  const at = event.at
  const topics = normalizeTopics(event.topics)
  if (!existing) {
    return {
      problemId: event.problemId,
      title: event.title ?? null,
      url: event.url,
      difficulty: event.difficulty ?? null,
      topics,
      firstSolvedAt: at,
      lastAcceptedAt: at,
      revisionHistory: [],
      eligibilityDate: initialDueDay(at),
      nextRevisionAt: initialDueDay(at),
    }
  }
  const firstSolvedAt = existing.firstSolvedAt ?? at
  const lastAcceptedAt = existing.lastAcceptedAt > at ? existing.lastAcceptedAt : at
  // Topics only fill in (never overwrite): the problem page may not expose
  // tags, and a bare re-solve must not erase what a sync already stored.
  const existingTopics = normalizeTopics(existing.topics)
  return {
    ...existing, // preserves revisionHistory and any existing revision schedule
    title: existing.title ?? event.title ?? null,
    difficulty: existing.difficulty ?? event.difficulty ?? null,
    firstSolvedAt,
    lastAcceptedAt,
    ...(existingTopics.length || !topics.length ? {} : { topics }),
    eligibilityDate: existing.eligibilityDate ?? (
      existing.nextRevisionAt ?? initialDueDay(firstSolvedAt)
    ),
    nextRevisionAt: existing.nextRevisionAt ?? existing.eligibilityDate ?? initialDueDay(firstSolvedAt),
  }
}

export function recordAccepted(problems, event) {
  const all = problems ?? {}
  return {
    ...all,
    [event.problemId]: upsertProblem(all[event.problemId], event),
  }
}
