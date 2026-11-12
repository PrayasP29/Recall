// Pure revision-tracking logic — no DOM, no chrome.*.
//
// Shared single source of truth for:
// - Unique revised problem count
// - Consecutive calendar-day revision streaks (with same-day grace preservation)
// - Idempotent recording with same-day duplicate prevention
// - Weekly activity calendar daily markers (max 2 per day, exactly 1 per distinct question)

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
 * Returns a Set of all distinct local calendar dates ('YYYY-MM-DD') that have
 * at least one revision recorded.
 *
 * @param {Array<{date: string}>} activity
 * @returns {Set<string>}
 */
export function getActiveRevisionDates(activity = []) {
  const dates = new Set();
  if (!Array.isArray(activity)) return dates;
  for (const entry of activity) {
    if (entry?.date) {
      dates.add(entry.date);
    }
  }
  return dates;
}

/**
 * Checks if a specific calendar day is active (has >= 1 recorded revision).
 *
 * @param {Array<{date: string}>} activity
 * @param {string} [day]
 * @returns {boolean}
 */
export function isDayActive(activity = [], day = toLocalDay()) {
  if (!Array.isArray(activity) || activity.length === 0 || !day) return false;
  return activity.some((entry) => entry?.date === day);
}

/**
 * Calculates the current consecutive calendar day revision streak.
 *
 * Rules:
 * - At least one recorded revision today means today is active.
 * - Consecutive active local calendar days increase the streak.
 * - Multiple revisions on the same day count as one active day.
 * - If today has no activity yet but yesterday was active, preserve the existing
 *   streak until the local day ends (standard streak preservation convention).
 * - If neither today nor yesterday has activity, the streak is broken (0 days).
 *
 * @param {Array<{date: string}>} activity
 * @param {string} [today] - 'YYYY-MM-DD' local date string
 * @returns {number}
 */
export function calculateStreak(activity = [], today = toLocalDay()) {
  if (!Array.isArray(activity) || activity.length === 0 || !today) return 0;

  const activeDays = getActiveRevisionDates(activity);

  const isTodayActive = activeDays.has(today);
  const yesterday = addDays(today, -1);
  const isYesterdayActive = activeDays.has(yesterday);

  // If neither today nor yesterday is active, the streak is 0
  if (!isTodayActive && !isYesterdayActive) {
    return 0;
  }

  // Count backwards starting from today (if today active) or yesterday (if today pending)
  let streak = 0;
  let currentDay = isTodayActive ? today : yesterday;

  while (activeDays.has(currentDay)) {
    streak += 1;
    currentDay = addDays(currentDay, -1);
  }

  return streak;
}

/**
 * Derives the calendar activity markers for a given day in the weekly strip.
 *
 * Requirements:
 * - Exactly one marker per distinct question.
 * - Maximum two markers per day (corresponding to the two daily revision questions).
 * - Completed revision on that day -> 'completed' (filled square).
 * - Question selected for that day but not revised -> 'pending' (outlined square).
 * - Future days show no pending markers (not yet due).
 *
 * @param {Object} options
 * @param {string} options.dayStr - 'YYYY-MM-DD'
 * @param {Record<string, Array<string>>} [options.dailySelections]
 * @param {Array<{problemId: string, date: string}>} [options.revisionActivity]
 * @param {string} [options.todayDay]
 * @returns {{ dayStr: string, isToday: boolean, isFuture: boolean, markers: Array<{problemId: string, status: 'completed'|'pending'}>, completedCount: number }}
 */
export function getCalendarDayActivity({
  dayStr,
  dailySelections = {},
  revisionActivity = [],
  todayDay = toLocalDay(),
}) {
  const isToday = dayStr === todayDay;
  const isFuture = dayStr > todayDay;

  // 1. Identify problems revised on this day
  const revisedOnDay = Array.isArray(revisionActivity)
    ? revisionActivity.filter((r) => r?.date === dayStr && r?.problemId)
    : [];
  const revisedProblemIds = Array.from(
    new Set(revisedOnDay.map((r) => String(r.problemId)))
  );

  // 2. Identify problems selected for this day
  const rawSelected = dailySelections?.[dayStr] ?? [];
  const selectedProblemIds = Array.isArray(rawSelected)
    ? Array.from(new Set(rawSelected.map((id) => String(id)).filter(Boolean)))
    : [];

  // 3. Assemble distinct daily questions for this day (capped at 2)
  // Revisions on this day take precedence for representation
  const distinctIds = [...revisedProblemIds];
  for (const id of selectedProblemIds) {
    if (!distinctIds.includes(id)) {
      distinctIds.push(id);
    }
  }

  const cappedIds = distinctIds.slice(0, 2);

  // 4. Map each distinct question to exactly one marker
  const markers = [];
  for (const id of cappedIds) {
    const isRevised = revisedProblemIds.includes(id);
    if (isRevised) {
      markers.push({ problemId: id, status: 'completed' });
    } else if (!isFuture) {
      // Pending markers appear for today and past days, never future days
      markers.push({ problemId: id, status: 'pending' });
    }
  }

  const completedCount = markers.filter((m) => m.status === 'completed').length;

  return {
    dayStr,
    isToday,
    isFuture,
    markers,
    completedCount,
  };
}
