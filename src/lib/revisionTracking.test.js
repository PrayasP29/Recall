import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordRevision,
  calculateUniqueRevisedCount,
  calculateStreak,
  isProblemRevisedOnDate,
  getActiveRevisionDates,
  isDayActive,
  getCalendarDayActivity,
  REVISION_ACTIVITY_STORAGE_KEY,
} from './revisionTracking.js';

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
