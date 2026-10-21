const SLUG_RE = /^[a-z0-9-]+$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const DIFFICULTIES = new Set(['Easy', 'Medium', 'Hard'])
const REVIEW_RESULTS = new Set(['remembered', 'forgotten'])

const isObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value)

export function isProblemId(value) {
  return typeof value === 'string' && SLUG_RE.test(value)
}

export function isAcceptedEvent(value) {
  return (
    isObject(value) &&
    isProblemId(value.problemId) &&
    typeof value.at === 'string' &&
    Number.isFinite(Date.parse(value.at)) &&
    (value.title == null || typeof value.title === 'string') &&
    (value.difficulty == null || DIFFICULTIES.has(value.difficulty)) &&
    Array.isArray(value.topics)
  )
}

export function isHistoryMerge(value) {
  return (
    isObject(value) &&
    Array.isArray(value.questions) &&
    (value.importStatus === 'complete' || value.importStatus === 'partial') &&
    Number.isInteger(value.totalNum) &&
    value.totalNum >= 0 &&
    typeof value.todayDay === 'string' &&
    DAY_RE.test(value.todayDay)
  )
}

export function isReviewRequest(value) {
  return (
    isObject(value) &&
    isProblemId(value.problemId) &&
    REVIEW_RESULTS.has(value.result)
  )
}
