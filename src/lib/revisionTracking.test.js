import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordRevision,
  recordAcceptedRevision,
  calculateUniqueRevisedCount,
  calculateStreak,
  isProblemRevisedOnDate,
  getActiveRevisionDates,
  isDayActive,
  getCalendarDayActivity,
  REVISION_ACTIVITY_STORAGE_KEY,
} from './revisionTracking.js';
import { findVerdictInRecords } from './tracker.js';

test('REVISION_ACTIVITY_STORAGE_KEY is named properly', () => {
  assert.equal(REVISION_ACTIVITY_STORAGE_KEY, 'revisionActivity');
});

test('marking one problem as revised adds a record (Regression Test 3)', () => {
  const initial = [];
  const res = recordRevision(initial, 'two-sum', '2026-04-10', '2026-04-10T10:00:00.000Z');

  assert.equal(res.isNew, true);
  assert.equal(res.nextActivity.length, 1);
  assert.deepEqual(res.record, {
    problemId: 'two-sum',
    date: '2026-04-10',
    timestamp: '2026-04-10T10:00:00.000Z',
  });
  assert.equal(calculateUniqueRevisedCount(res.nextActivity), 1);
});

test('duplicate records for one question do not create duplicate markers or records (Regression Test 2)', () => {
  const initial = [
    { problemId: 'two-sum', date: '2026-04-10', timestamp: '2026-04-10T10:00:00.000Z' },
  ];
  const res = recordRevision(initial, 'two-sum', '2026-04-10', '2026-04-10T11:00:00.000Z');

  assert.equal(res.isNew, false);
  assert.equal(res.nextActivity.length, 1);
  assert.equal(res.record.timestamp, '2026-04-10T10:00:00.000Z');

  // Calendar activity for day with duplicates in raw input produces exactly 1 marker
  const activity = getCalendarDayActivity({
    dayStr: '2026-04-10',
    dailySelections: { '2026-04-10': ['two-sum', 'two-sum'] },
    revisionActivity: [
      { problemId: 'two-sum', date: '2026-04-10' },
      { problemId: 'two-sum', date: '2026-04-10' },
    ],
    todayDay: '2026-04-10',
  });

  assert.equal(activity.markers.length, 1);
  assert.equal(activity.markers[0].problemId, 'two-sum');
  assert.equal(activity.markers[0].status, 'completed');
});

test('two selected questions produce no more than two calendar markers (Regression Test 1)', () => {
  // Case A: 0 of 2 revised -> 2 pending markers
  const caseA = getCalendarDayActivity({
    dayStr: '2026-04-10',
    dailySelections: { '2026-04-10': ['p1', 'p2'] },
    revisionActivity: [],
    todayDay: '2026-04-10',
  });
  assert.equal(caseA.markers.length, 2);
  assert.equal(caseA.markers[0].status, 'pending');
  assert.equal(caseA.markers[1].status, 'pending');

  // Case B: 1 of 2 revised -> exactly 2 markers (1 completed, 1 pending)
  const caseB = getCalendarDayActivity({
    dayStr: '2026-04-10',
    dailySelections: { '2026-04-10': ['p1', 'p2'] },
    revisionActivity: [{ problemId: 'p1', date: '2026-04-10' }],
    todayDay: '2026-04-10',
  });
  assert.equal(caseB.markers.length, 2);
  assert.equal(caseB.markers[0].problemId, 'p1');
  assert.equal(caseB.markers[0].status, 'completed');
  assert.equal(caseB.markers[1].problemId, 'p2');
  assert.equal(caseB.markers[1].status, 'pending');

  // Case C: 2 of 2 revised -> exactly 2 markers (2 completed)
  const caseC = getCalendarDayActivity({
    dayStr: '2026-04-10',
    dailySelections: { '2026-04-10': ['p1', 'p2'] },
    revisionActivity: [
      { problemId: 'p1', date: '2026-04-10' },
      { problemId: 'p2', date: '2026-04-10' },
    ],
    todayDay: '2026-04-10',
  });
  assert.equal(caseC.markers.length, 2);
  assert.equal(caseC.markers[0].status, 'completed');
  assert.equal(caseC.markers[1].status, 'completed');
});

test('one completed revision makes today active (Regression Test 4)', () => {
  const activity = [{ problemId: 'p1', date: '2026-04-10' }];
  assert.equal(isDayActive(activity, '2026-04-10'), true);
  assert.equal(calculateStreak(activity, '2026-04-10'), 1);
});

test('two completed revisions on the same day increase Revised but count as one streak day (Regression Test 5)', () => {
  const activity = [
    { problemId: 'p1', date: '2026-04-10' },
    { problemId: 'p2', date: '2026-04-10' },
  ];
  assert.equal(calculateUniqueRevisedCount(activity), 2);
  assert.equal(calculateStreak(activity, '2026-04-10'), 1);
});

test('revising the same problem on another day does not increase distinct Revised count (Regression Test 6)', () => {
  let activity = [];
  activity = recordRevision(activity, 'two-sum', '2026-04-10').nextActivity;
  activity = recordRevision(activity, 'two-sum', '2026-04-11').nextActivity;

  assert.equal(activity.length, 2);
  assert.equal(calculateUniqueRevisedCount(activity), 1);
});

test('consecutive active days calculate the correct streak (Regression Test 7)', () => {
  const activity = [
    { problemId: 'p1', date: '2026-04-08' },
    { problemId: 'p2', date: '2026-04-09' },
    { problemId: 'p3', date: '2026-04-10' },
  ];
  assert.equal(calculateStreak(activity, '2026-04-10'), 3);
});

test('missing a day breaks the streak (Regression Test 8)', () => {
  // Activity on 2026-04-07 and 2026-04-08, but 2026-04-09 had no activity.
  // Today is 2026-04-10 with no activity -> streak broken (0)
  const activity = [
    { problemId: 'p1', date: '2026-04-07' },
    { problemId: 'p2', date: '2026-04-08' },
  ];
  assert.equal(calculateStreak(activity, '2026-04-10'), 0);
});

test('streak preservation: active yesterday preserves streak until today ends', () => {
  // Active on 2026-04-08 and 2026-04-09. Today is 2026-04-10 with no activity yet today.
  const activity = [
    { problemId: 'p1', date: '2026-04-08' },
    { problemId: 'p2', date: '2026-04-09' },
  ];
  assert.equal(calculateStreak(activity, '2026-04-10'), 2);
});

test('calendar markers and progress metrics agree about revision activity (Regression Test 9)', () => {
  const dailySelections = { '2026-04-10': ['two-sum', 'valid-anagram'] };
  let activity = [];

  // Before revising anything on 2026-04-10:
  assert.equal(calculateUniqueRevisedCount(activity), 0);
  assert.equal(calculateStreak(activity, '2026-04-10'), 0);
  let cal = getCalendarDayActivity({
    dayStr: '2026-04-10',
    dailySelections,
    revisionActivity: activity,
    todayDay: '2026-04-10',
  });
  assert.equal(cal.completedCount, 0);
  assert.equal(cal.markers.filter((m) => m.status === 'completed').length, 0);
  assert.equal(cal.markers.filter((m) => m.status === 'pending').length, 2);

  // User revises one problem:
  activity = recordRevision(activity, 'two-sum', '2026-04-10').nextActivity;

  // Now both Progress metrics and Calendar markers agree:
  assert.equal(calculateUniqueRevisedCount(activity), 1);
  assert.equal(calculateStreak(activity, '2026-04-10'), 1);
  cal = getCalendarDayActivity({
    dayStr: '2026-04-10',
    dailySelections,
    revisionActivity: activity,
    todayDay: '2026-04-10',
  });
  assert.equal(cal.completedCount, 1);
  assert.equal(cal.markers.filter((m) => m.status === 'completed').length, 1);
  assert.equal(cal.markers.filter((m) => m.status === 'pending').length, 1);
  assert.equal(cal.markers.length, 2);
});

test('reading activity does not invent or mutate revision data (Regression Test 10)', () => {
  const original = Object.freeze([
    Object.freeze({ problemId: 'p1', date: '2026-04-10' }),
  ]);
  const cal = getCalendarDayActivity({
    dayStr: '2026-04-10',
    dailySelections: { '2026-04-10': ['p1', 'p2'] },
    revisionActivity: original,
    todayDay: '2026-04-10',
  });
  assert.equal(cal.markers.length, 2);
  assert.equal(original.length, 1);
});

test('future days do not show pending markers', () => {
  const cal = getCalendarDayActivity({
    dayStr: '2026-04-12',
    dailySelections: { '2026-04-12': ['p1', 'p2'] },
    revisionActivity: [],
    todayDay: '2026-04-10',
  });
  assert.equal(cal.isFuture, true);
  assert.equal(cal.markers.length, 0);
});

test('getActiveRevisionDates returns set of unique dates', () => {
  const activity = [
    { problemId: 'p1', date: '2026-04-10' },
    { problemId: 'p2', date: '2026-04-10' },
    { problemId: 'p3', date: '2026-04-11' },
  ];
  const dates = getActiveRevisionDates(activity);
  assert.deepEqual(Array.from(dates).sort(), ['2026-04-10', '2026-04-11']);
});

test('streak calculation handles month and year boundaries correctly', () => {
  const activity = [
    { problemId: 'p1', date: '2026-12-30' },
    { problemId: 'p2', date: '2026-12-31' },
    { problemId: 'p3', date: '2027-01-01' },
  ];
  assert.equal(calculateStreak(activity, '2027-01-01'), 3);
});

test('isProblemRevisedOnDate correctly detects revised state', () => {
  const activity = [{ problemId: 'two-sum', date: '2026-04-10' }];

  assert.equal(isProblemRevisedOnDate(activity, 'two-sum', '2026-04-10'), true);
  assert.equal(isProblemRevisedOnDate(activity, 'two-sum', '2026-04-11'), false);
  assert.equal(isProblemRevisedOnDate(activity, '3sum', '2026-04-10'), false);
});

// ============================================================================
// AUTOMATIC LEETCODE REVISION TRACKING REGRESSION SUITE (SCENARIOS 1-12)
// ============================================================================

test('Scenario 1: Accepted submission records a revision automatically', () => {
  const problems = { 'two-sum': { problemId: 'two-sum', title: 'Two Sum' } };
  const dailySelections = { '2026-04-10': ['two-sum', 'valid-anagram'] };
  let activity = [];

  const result = recordAcceptedRevision({
    problems,
    dailySelections,
    revisionActivity: activity,
    problemId: 'two-sum',
    date: '2026-04-10',
    timestamp: '2026-04-10T14:30:00.000Z',
  });

  assert.equal(result.isRecorded, true);
  assert.equal(result.nextActivity.length, 1);
  assert.deepEqual(result.record, {
    problemId: 'two-sum',
    date: '2026-04-10',
    timestamp: '2026-04-10T14:30:00.000Z',
  });
  assert.equal(isProblemRevisedOnDate(result.nextActivity, 'two-sum', '2026-04-10'), true);
});

test('Scenario 2: Wrong Answer does not record a revision', () => {
  const records = [{ type: 'characterData', target: { textContent: 'Wrong Answer' } }];
  const verdict = findVerdictInRecords(records);
  assert.equal(verdict, 'rejected');

  // Because verdict is rejected, recordAcceptedRevision is never invoked
  const activity = [];
  assert.equal(activity.length, 0);
  assert.equal(calculateUniqueRevisedCount(activity), 0);
});

test('Scenario 3: Pending verdict does not record a revision', () => {
  const records = [{ type: 'characterData', target: { textContent: 'Pending' } }];
  const verdict = findVerdictInRecords(records);
  assert.equal(verdict, null);

  // Still pending, no revision recorded
  const activity = [];
  assert.equal(activity.length, 0);
});

test('Scenario 4: Multiple DOM updates do not create duplicate records', () => {
  const problems = { 'two-sum': { problemId: 'two-sum' } };
  const dailySelections = { '2026-04-10': ['two-sum'] };
  let activity = [];

  // First DOM update with Accepted
  const first = recordAcceptedRevision({
    problems,
    dailySelections,
    revisionActivity: activity,
    problemId: 'two-sum',
    date: '2026-04-10',
  });
  assert.equal(first.isRecorded, true);
  activity = first.nextActivity;

  // Immediate subsequent DOM rerender / mutation for same problem
  const second = recordAcceptedRevision({
    problems,
    dailySelections,
    revisionActivity: activity,
    problemId: 'two-sum',
    date: '2026-04-10',
  });
  assert.equal(second.isRecorded, false);
  assert.equal(second.nextActivity.length, 1);
});

test('Scenario 5: Repeated acceptance of the same problem on the same day is idempotent', () => {
  const problems = { 'two-sum': { problemId: 'two-sum' } };
  let activity = [];

  // User submits and gets Accepted 3 times in one afternoon
  for (let i = 0; i < 3; i++) {
    const res = recordAcceptedRevision({
      problems,
      revisionActivity: activity,
      problemId: 'two-sum',
      date: '2026-04-10',
      timestamp: `2026-04-10T14:0${i}:00.000Z`,
    });
    activity = res.nextActivity;
  }

  assert.equal(activity.length, 1);
  assert.equal(calculateUniqueRevisedCount(activity), 1);
});

test('Scenario 6: Different accepted problems on the same day are recorded independently', () => {
  const problems = {
    'two-sum': { problemId: 'two-sum' },
    'valid-anagram': { problemId: 'valid-anagram' },
  };
  let activity = [];

  const res1 = recordAcceptedRevision({
    problems,
    revisionActivity: activity,
    problemId: 'two-sum',
    date: '2026-04-10',
  });
  activity = res1.nextActivity;

  const res2 = recordAcceptedRevision({
    problems,
    revisionActivity: activity,
    problemId: 'valid-anagram',
    date: '2026-04-10',
  });
  activity = res2.nextActivity;

  assert.equal(activity.length, 2);
  assert.equal(calculateUniqueRevisedCount(activity), 2);
});

test('Scenario 7: Accepted submission updates Revised count', () => {
  const problems = {
    'two-sum': { problemId: 'two-sum' },
    'valid-anagram': { problemId: 'valid-anagram' },
  };
  let activity = [];
  assert.equal(calculateUniqueRevisedCount(activity, problems), 0);

  // First problem accepted
  activity = recordAcceptedRevision({
    problems,
    revisionActivity: activity,
    problemId: 'two-sum',
    date: '2026-04-10',
  }).nextActivity;
  assert.equal(calculateUniqueRevisedCount(activity, problems), 1);

  // Same problem accepted again tomorrow does not inflate distinct count
  activity = recordAcceptedRevision({
    problems,
    revisionActivity: activity,
    problemId: 'two-sum',
    date: '2026-04-11',
  }).nextActivity;
  assert.equal(calculateUniqueRevisedCount(activity, problems), 1);

  // Different problem accepted increases distinct count
  activity = recordAcceptedRevision({
    problems,
    revisionActivity: activity,
    problemId: 'valid-anagram',
    date: '2026-04-11',
  }).nextActivity;
  assert.equal(calculateUniqueRevisedCount(activity, problems), 2);
});

test('Scenario 8: Accepted submission activates the daily streak', () => {
  const problems = { 'two-sum': { problemId: 'two-sum' } };
  // Streak yesterday was 2 (active on 2026-04-08 and 2026-04-09)
  let activity = [
    { problemId: 'p1', date: '2026-04-08' },
    { problemId: 'p2', date: '2026-04-09' },
  ];

  // Prior to submission today:
  assert.equal(isDayActive(activity, '2026-04-10'), false);
  assert.equal(calculateStreak(activity, '2026-04-10'), 2); // preserved from yesterday

  // Automatic acceptance lands today:
  activity = recordAcceptedRevision({
    problems,
    revisionActivity: activity,
    problemId: 'two-sum',
    date: '2026-04-10',
  }).nextActivity;

  assert.equal(isDayActive(activity, '2026-04-10'), true);
  assert.equal(calculateStreak(activity, '2026-04-10'), 3);
});

test('Scenario 9: Accepted submission fills the correct calendar marker', () => {
  const dailySelections = { '2026-04-10': ['two-sum', 'valid-anagram'] };
  let activity = [];

  // Before submission on 2026-04-10: 2 pending markers
  let cal = getCalendarDayActivity({
    dayStr: '2026-04-10',
    dailySelections,
    revisionActivity: activity,
    todayDay: '2026-04-10',
  });
  assert.equal(cal.markers.length, 2);
  assert.equal(cal.markers[0].status, 'pending');
  assert.equal(cal.markers[1].status, 'pending');

  // Automatic acceptance on 'two-sum'
  activity = recordAcceptedRevision({
    problems: { 'two-sum': {} },
    dailySelections,
    revisionActivity: activity,
    problemId: 'two-sum',
    date: '2026-04-10',
  }).nextActivity;

  cal = getCalendarDayActivity({
    dayStr: '2026-04-10',
    dailySelections,
    revisionActivity: activity,
    todayDay: '2026-04-10',
  });
  assert.equal(cal.markers.length, 2);
  assert.equal(cal.markers[0].problemId, 'two-sum');
  assert.equal(cal.markers[0].status, 'completed');
  assert.equal(cal.markers[1].problemId, 'valid-anagram');
  assert.equal(cal.markers[1].status, 'pending');
  assert.equal(cal.completedCount, 1);
});

test('Scenario 10: Manual and automatic recording share the same data source', () => {
  const problems = { 'two-sum': { problemId: 'two-sum' } };
  let activity = [];

  // User manually marks revised first
  activity = recordRevision(activity, 'two-sum', '2026-04-10').nextActivity;
  assert.equal(activity.length, 1);

  // Later on the same day, user gets Accepted on LeetCode
  const autoResult = recordAcceptedRevision({
    problems,
    revisionActivity: activity,
    problemId: 'two-sum',
    date: '2026-04-10',
  });
  assert.equal(autoResult.isRecorded, false);
  assert.equal(autoResult.nextActivity.length, 1);

  // And in reverse order:
  let reverseActivity = [];
  reverseActivity = recordAcceptedRevision({
    problems,
    revisionActivity: reverseActivity,
    problemId: 'two-sum',
    date: '2026-04-10',
  }).nextActivity;
  assert.equal(reverseActivity.length, 1);

  const manualResult = recordRevision(reverseActivity, 'two-sum', '2026-04-10');
  assert.equal(manualResult.isNew, false);
  assert.equal(manualResult.nextActivity.length, 1);
});

test('Scenario 11: Historical imported solves do not inflate revision metrics', () => {
  // Suppose 50 problems are imported via LeetCode sync into problems
  const importedProblems = {};
  for (let i = 1; i <= 50; i++) {
    importedProblems[`problem-${i}`] = {
      problemId: `problem-${i}`,
      imported: true,
      firstSolvedAt: null,
    };
  }

  // Revision activity starts empty
  const activity = [];

  assert.equal(calculateUniqueRevisedCount(activity, importedProblems), 0);
  assert.equal(calculateStreak(activity, '2026-04-10'), 0);
});

test('Scenario 12: Untracked problems are not incorrectly added to revision metrics', () => {
  // Problems library contains only 'two-sum'
  const problems = { 'two-sum': { problemId: 'two-sum' } };
  const dailySelections = { '2026-04-10': ['two-sum'] };
  let activity = [];

  // User solves a brand new, previously untracked problem 'trapping-rain-water'
  const result = recordAcceptedRevision({
    problems,
    dailySelections,
    revisionActivity: activity,
    problemId: 'trapping-rain-water',
    date: '2026-04-10',
  });

  assert.equal(result.isRecorded, false);
  assert.equal(result.reason, 'untracked');
  assert.equal(result.nextActivity.length, 0);
  assert.equal(calculateUniqueRevisedCount(result.nextActivity, problems), 0);
});
