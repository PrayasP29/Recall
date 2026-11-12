// Pure revision-tracking logic — no DOM, no chrome.*.
//
// Records user-initiated revision completions and calculates revision metrics:
// - Unique revised problem count
// - Consecutive calendar-day revision streaks
// - Idempotent recording with same-day duplicate prevention

import { toLocalDay, addDays } from './revisionScheduler.js';

export const REVISION_ACTIVITY_STORAGE_KEY = 'revisionActivity';

/**
 * Checks if a problem has already been marked as revised on a specific local date.
 *
 * @param {Array<{problemId: string, date: string}>} activity
 * @param {string|number} problemId
 * @param {string} [date] - 'YYYY-MM-DD' local date string
 * @returns {boolean}
 */
export function isProblemRevisedOnDate(activity = [], problemId, date = toLocalDay()) {
  if (!Array.isArray(activity) || !problemId || !date) return false;
  const targetId = String(problemId);
  return activity.some((entry) => String(entry?.problemId) === targetId && entry?.date === date);
}

/**
 * Adds a revision entry if not already recorded for that problem on that date.
 * Repeated calls on the same day for the same problem are idempotent.
 *
 * @param {Array<{problemId: string, date: string, timestamp: string}>} activity
 * @param {string|number} problemId
 * @param {string} [date] - 'YYYY-MM-DD'
 * @param {string} [timestamp] - ISO 8601 string
 * @returns {{ nextActivity: Array, isNew: boolean, record: Object }}
 */
export function recordRevision(
  activity = [],
  problemId,
  date = toLocalDay(),
  timestamp = new Date().toISOString()
) {
  if (!problemId) {
    throw new Error('problemId is required to record a revision');
  }

  const safeActivity = Array.isArray(activity) ? [...activity] : [];
  const targetId = String(problemId);

  const existing = safeActivity.find(
    (entry) => String(entry?.problemId) === targetId && entry?.date === date
  );

  if (existing) {
    return {
      nextActivity: safeActivity,
      isNew: false,
      record: existing,
    };
  }

  const newRecord = {
    problemId: targetId,
    date,
    timestamp,
  };

  return {
    nextActivity: [...safeActivity, newRecord],
    isNew: true,
    record: newRecord,
  };
}

/**
 * Calculates the number of distinct tracked problems marked as revised at least once.
 * Re-revising the same problem multiple times does not inflate this count.
 *
 * @param {Array<{problemId: string}>} activity
 * @param {Record<string, unknown>|null} [problems] - Optional problem map to filter by tracked problems
 * @returns {number}
 */
export function calculateUniqueRevisedCount(activity = [], problems = null) {
  if (!Array.isArray(activity) || activity.length === 0) return 0;

  const uniqueProblemIds = new Set();
  for (const entry of activity) {
    if (!entry?.problemId) continue;
    const id = String(entry.problemId);
    if (!problems || Object.prototype.hasOwnProperty.call(problems, id)) {
      uniqueProblemIds.add(id);
    }
  }

  return uniqueProblemIds.size;
}

/**
 * Calculates the current consecutive calendar day revision streak.
 *
 * Rules:
 * - A day counts as active if >= 1 problem was marked as revised on that calendar day.
 * - Multiple revisions on the same calendar day count as one active day.
 * - Consecutive active calendar days increase the streak.
 * - If today has no revision activity, the current streak on today is 0 days.
 * - If today has revision activity, the streak is 1 + consecutive active days backwards.
 *
 * @param {Array<{date: string}>} activity
 * @param {string} [today] - 'YYYY-MM-DD' local date string
 * @returns {number}
 */
export function calculateStreak(activity = [], today = toLocalDay()) {
  if (!Array.isArray(activity) || activity.length === 0 || !today) return 0;

  const activeDays = new Set();
  for (const entry of activity) {
    if (entry?.date) {
      activeDays.add(entry.date);
    }
  }

  // If the user has not revised anything today, current streak is 0.
  if (!activeDays.has(today)) {
    return 0;
  }

  let streak = 0;
  let currentDay = today;

  while (activeDays.has(currentDay)) {
    streak += 1;
    currentDay = addDays(currentDay, -1);
  }

  return streak;
}
