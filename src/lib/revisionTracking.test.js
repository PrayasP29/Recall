import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordRevision,
  calculateUniqueRevisedCount,
  calculateStreak,
  isProblemRevisedOnDate,
  REVISION_ACTIVITY_STORAGE_KEY,
} from './revisionTracking.js';

test('REVISION_ACTIVITY_STORAGE_KEY is named properly', () => {
  assert.equal(REVISION_ACTIVITY_STORAGE_KEY, 'revisionActivity');
});

test('marking one problem as revised adds a record', () => {
  const initial = [];
  const res = recordRevision(initial, 'two-sum', '2026-04-10', '2026-04-10T10:00:00.000Z');

  assert.equal(res.isNew, true);
  assert.equal(res.nextActivity.length, 1);
  assert.deepEqual(res.record, {
    problemId: 'two-sum',
    date: '2026-04-10',
    timestamp: '2026-04-10T10:00:00.000Z',
  });
});

test('marking the same problem twice on the same day is idempotent (duplicate prevention)', () => {
  const initial = [
    { problemId: 'two-sum', date: '2026-04-10', timestamp: '2026-04-10T10:00:00.000Z' },
  ];
  const res = recordRevision(initial, 'two-sum', '2026-04-10', '2026-04-10T11:00:00.000Z');

  assert.equal(res.isNew, false);
  assert.equal(res.nextActivity.length, 1);
  assert.equal(res.record.timestamp, '2026-04-10T10:00:00.000Z');
});

test('revising multiple problems on one day creates distinct records', () => {
  let activity = [];
  const res1 = recordRevision(activity, 'two-sum', '2026-04-10');
  activity = res1.nextActivity;

  const res2 = recordRevision(activity, '3sum', '2026-04-10');
  activity = res2.nextActivity;

  assert.equal(activity.length, 2);
  assert.equal(res1.isNew, true);
  assert.equal(res2.isNew, true);
});

test('revising the same problem on different days creates records for each day', () => {
  let activity = [];
  activity = recordRevision(activity, 'two-sum', '2026-04-10').nextActivity;
  activity = recordRevision(activity, 'two-sum', '2026-04-11').nextActivity;

  assert.equal(activity.length, 2);
  // Distinct revised count should still be 1 because it is the same problem
  assert.equal(calculateUniqueRevisedCount(activity), 1);
});

test('calculateUniqueRevisedCount counts distinct problemIds', () => {
  const activity = [
    { problemId: 'two-sum', date: '2026-04-01' },
    { problemId: '3sum', date: '2026-04-01' },
    { problemId: 'two-sum', date: '2026-04-02' },
    { problemId: 'lru-cache', date: '2026-04-02' },
  ];

  assert.equal(calculateUniqueRevisedCount(activity), 3);
});

test('calculateUniqueRevisedCount filters by problems map when provided', () => {
  const activity = [
    { problemId: 'two-sum', date: '2026-04-01' },
    { problemId: 'deleted-problem', date: '2026-04-01' },
  ];
  const problems = {
    'two-sum': { title: 'Two Sum' },
  };

  assert.equal(calculateUniqueRevisedCount(activity, problems), 1);
});

test('empty revision history returns 0 for streak and revised count', () => {
  assert.equal(calculateStreak([]), 0);
  assert.equal(calculateStreak(null), 0);
  assert.equal(calculateUniqueRevisedCount([]), 0);
  assert.equal(calculateUniqueRevisedCount(null), 0);
});

test('streak calculation: 1 problem revised today gives streak of 1', () => {
  const activity = [{ problemId: 'two-sum', date: '2026-04-10' }];
  assert.equal(calculateStreak(activity, '2026-04-10'), 1);
});

test('streak calculation: multiple problems revised today gives streak of 1', () => {
  const activity = [
    { problemId: 'two-sum', date: '2026-04-10' },
    { problemId: '3sum', date: '2026-04-10' },
  ];
  assert.equal(calculateStreak(activity, '2026-04-10'), 1);
});

test('streak calculation: revised yesterday and today gives streak of 2', () => {
  const activity = [
    { problemId: 'two-sum', date: '2026-04-09' },
    { problemId: '3sum', date: '2026-04-10' },
  ];
  assert.equal(calculateStreak(activity, '2026-04-10'), 2);
});

test('streak calculation: 3 consecutive days gives streak of 3', () => {
  const activity = [
    { problemId: 'p1', date: '2026-04-08' },
    { problemId: 'p2', date: '2026-04-09' },
    { problemId: 'p3', date: '2026-04-10' },
  ];
  assert.equal(calculateStreak(activity, '2026-04-10'), 3);
});

test('streak calculation: broken streak with no activity today returns 0 on today', () => {
  // Activity on 2026-04-08 and 2026-04-09, but today is 2026-04-10 with no activity
  const activity = [
    { problemId: 'p1', date: '2026-04-08' },
    { problemId: 'p2', date: '2026-04-09' },
  ];
  assert.equal(calculateStreak(activity, '2026-04-10'), 0);
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
  const activity = [
    { problemId: 'two-sum', date: '2026-04-10' },
  ];

  assert.equal(isProblemRevisedOnDate(activity, 'two-sum', '2026-04-10'), true);
  assert.equal(isProblemRevisedOnDate(activity, 'two-sum', '2026-04-11'), false);
  assert.equal(isProblemRevisedOnDate(activity, '3sum', '2026-04-10'), false);
});
