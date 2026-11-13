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
  'Compilation Error',
  'Output Limit Exceeded',
  'Internal Error',
])

// 'accepted' | 'rejected' | null. Exact trimmed match only — a colored
// element or substring ("Accepted solution pattern") never classifies.
export function classifyVerdict(text) {
  if (typeof text !== 'string') return null
  const t = text.replace(/\u00a0/g, ' ').trim()
  if (t === ACCEPTED_TEXT || t.toLowerCase() === 'accepted') return 'accepted'
  for (const r of REJECTED_TEXT) {
    if (t.toLowerCase() === r.toLowerCase()) return 'rejected'
  }
  return null
}

/**
 * Determines whether a clicked DOM element corresponds to LeetCode's Submit button.
 * Handles nested elements (icons, paths, inner spans), data-attributes, aria labels, and text.
 */
export function isSubmitElement(element) {
  if (!element || typeof element.closest !== 'function') return false

  const btn = element.closest('button, [role="button"], [data-e2e-locator*="submit"], [data-cypress*="submit"]')
  if (!btn) return false

  // 1. Data attributes
  const e2e = (btn.getAttribute('data-e2e-locator') || '').toLowerCase()
  const cypress = (btn.getAttribute('data-cypress') || '').toLowerCase()
  const testId = (btn.getAttribute('data-testid') || '').toLowerCase()
  if (e2e.includes('submit') || cypress.includes('submit') || testId.includes('submit')) {
    return true
  }

  // 2. Aria labels and titles
  const aria = (btn.getAttribute('aria-label') || '').toLowerCase()
  const title = (btn.getAttribute('title') || '').toLowerCase()
  if (/submit/i.test(aria) || /submit/i.test(title)) {
    return true
  }

  // 3. Text content
  const text = (btn.textContent || '').trim().toLowerCase()
  if (/^submit(\b|\s|\(|$)/i.test(text)) {
    return true
  }

  return false
}

/**
 * Determines whether a keyboard event corresponds to LeetCode's submission shortcut (Ctrl+Enter or Cmd+Enter).
 */
export function isSubmitShortcut(event) {
  if (!event) return false
  const isEnter = event.key === 'Enter' || event.code === 'Enter'
  const hasModifier = Boolean(event.ctrlKey || event.metaKey)
  return isEnter && hasModifier
}

/**
 * Inspects a list of MutationObserver records for final verdicts ('accepted' | 'rejected').
 * Ignores pending/judging states.
 */
export function findVerdictInRecords(records) {
  if (!records || !Array.isArray(records)) return null

  for (const rec of records) {
    if (rec.type === 'characterData') {
      const v = classifyVerdict(rec.target?.textContent)
      if (v) return v
      continue
    }

    if (rec.addedNodes) {
      for (const node of rec.addedNodes) {
        if (!node) continue
        if (node.nodeType === 3 /* Node.TEXT_NODE */) {
          const v = classifyVerdict(node.textContent)
          if (v) return v
        } else if (node.nodeType === 1 /* Node.ELEMENT_NODE */) {
          if (typeof node.getAttribute === 'function') {
            const locator = (node.getAttribute('data-e2e-locator') || '').toLowerCase()
            const cypress = (node.getAttribute('data-cypress') || '').toLowerCase()
            if (locator.includes('submission-result') || cypress.includes('submission-result')) {
              const v = classifyVerdict(node.textContent)
              if (v) return v
            }
          }

          if (typeof document !== 'undefined' && typeof document.createTreeWalker === 'function') {
            const walker = document.createTreeWalker(node, 4 /* NodeFilter.SHOW_TEXT */)
            let t
            while ((t = walker.nextNode())) {
              const v = classifyVerdict(t.textContent)
              if (v) return v
            }
          } else if (node.textContent) {
            const v = classifyVerdict(node.textContent)
            if (v) return v
          }
        }
      }
    }
  }
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
