import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRecallUrl,
  isNativeNewTabUrl,
  hasSessionShown,
  markSessionShown,
  resetSessionState,
  shouldInterceptTab,
  RECALL_SESSION_SHOWN_KEY,
} from './sessionManager.js';

test('isRecallUrl detects Recall URLs accurately', () => {
  assert.equal(isRecallUrl('chrome-extension://xyz/newtab.html'), true);
  assert.equal(isRecallUrl('moz-extension://xyz/newtab.html'), true);
  assert.equal(isRecallUrl('safari-web-extension://xyz/newtab.html'), true);
  assert.equal(isRecallUrl('https://example.com/newtab.html'), true);
  assert.equal(isRecallUrl('https://leetcode.com/problems/two-sum/'), false);
  assert.equal(isRecallUrl(''), false);
  assert.equal(isRecallUrl(null), false);
});
test('isNativeNewTabUrl recognizes major desktop browser new tab URLs', () => {
  // Chrome / Chromium / Brave / Edge
  assert.equal(isNativeNewTabUrl('chrome://newtab'), true);
  assert.equal(isNativeNewTabUrl('chrome://newtab/'), true);
  assert.equal(isNativeNewTabUrl('edge://newtab'), true);
  assert.equal(isNativeNewTabUrl('edge://newtab/'), true);
  assert.equal(isNativeNewTabUrl('brave://newtab'), true);
  assert.equal(isNativeNewTabUrl('opera://startpage'), true);

  // Firefox
  assert.equal(isNativeNewTabUrl('about:newtab'), true);
  assert.equal(isNativeNewTabUrl('about:home'), true);

  // Safari
  assert.equal(isNativeNewTabUrl('favorites://'), true);
  assert.equal(isNativeNewTabUrl('safari-resource:/startPage.html'), true);

  // Blank / initial creation states
  assert.equal(isNativeNewTabUrl(''), true);
  assert.equal(isNativeNewTabUrl('about:blank'), true);
  assert.equal(isNativeNewTabUrl(undefined), true);

  // Non-newtab URLs
  assert.equal(isNativeNewTabUrl('https://google.com'), false);
  assert.equal(isNativeNewTabUrl('https://leetcode.com'), false);
});

test('shouldInterceptTab allows first new tab when session has not shown Recall', () => {
  const result = shouldInterceptTab({
    url: 'chrome://newtab/',
    pendingUrl: '',
    hasShownInSession: false,
    isNavigating: false,
    isRecallAlreadyOpen: false,
  });

  assert.equal(result, true);
});

test('shouldInterceptTab respects Firefox and Safari new tab targets', () => {
  assert.equal(
    shouldInterceptTab({
      url: 'about:newtab',
      hasShownInSession: false,
      isNavigating: false,
      isRecallAlreadyOpen: false,
    }),
    true
  );

  assert.equal(
    shouldInterceptTab({
      url: '',
      pendingUrl: 'favorites://',
      hasShownInSession: false,
      isNavigating: false,
      isRecallAlreadyOpen: false,
    }),
    true
  );
});

test('shouldInterceptTab returns false once Recall has already appeared in session (subsequent tabs)', () => {
  const result = shouldInterceptTab({
    url: 'chrome://newtab/',
    hasShownInSession: true,
    isNavigating: false,
    isRecallAlreadyOpen: false,
  });

  // Subsequent new tabs must use the browser's native New Tab page
  assert.equal(result, false);
});

test('shouldInterceptTab prevents duplicate navigation via concurrency lock', () => {
  const result = shouldInterceptTab({
    url: 'chrome://newtab/',
    hasShownInSession: false,
    isNavigating: true, // another tab is currently navigating
    isRecallAlreadyOpen: false,
  });

  assert.equal(result, false);
});

test('shouldInterceptTab returns false if Recall is already open in another tab', () => {
  const result = shouldInterceptTab({
    url: 'chrome://newtab/',
    hasShownInSession: false,
    isNavigating: false,
    isRecallAlreadyOpen: true,
  });

  assert.equal(result, false);
});

test('shouldInterceptTab does not intercept external or specific user navigations', () => {
  const result = shouldInterceptTab({
    url: 'https://leetcode.com/problemset/all/',
    hasShownInSession: false,
    isNavigating: false,
    isRecallAlreadyOpen: false,
  });

  assert.equal(result, false);
});

test('session state management: mark, check, and reset', async () => {
  const store = {};
  const mockStorage = {
    async get(key) {
      return { [key]: store[key] };
    },
    async set(items) {
      Object.assign(store, items);
    },
    async remove(key) {
      delete store[key];
    },
  };

  assert.equal(await hasSessionShown(mockStorage), false);

  await markSessionShown(mockStorage);
  assert.equal(await hasSessionShown(mockStorage), true);
  assert.equal(store[RECALL_SESSION_SHOWN_KEY], true);

  await resetSessionState(mockStorage);
  assert.equal(await hasSessionShown(mockStorage), false);
  assert.equal(store[RECALL_SESSION_SHOWN_KEY], undefined);
});

test('service worker suspension simulation: storage.session preserves state across restarts', async () => {
  // Simulate browser memory holding session storage
  const browserMemorySession = { [RECALL_SESSION_SHOWN_KEY]: true };
  const mockSessionStorage = {
    async get(key) {
      return { [key]: browserMemorySession[key] };
    },
  };

  // When a service worker wakes up after suspension, it reads session storage:
  const shownAfterWakeup = await hasSessionShown(mockSessionStorage);
  assert.equal(shownAfterWakeup, true);

  // New tab should not intercept:
  const shouldIntercept = shouldInterceptTab({
    url: 'chrome://newtab/',
    hasShownInSession: shownAfterWakeup,
    isNavigating: false,
    isRecallAlreadyOpen: false,
  });
  assert.equal(shouldIntercept, false);
});

test('browser restart simulation: cleared session storage resets session', async () => {
  // On browser restart, the process restarts with cleared memory and session storage
  await resetSessionState();
  const browserMemorySession = {};
  const mockSessionStorage = {
    async get(key) {
      return { [key]: browserMemorySession[key] };
    },
  };

  const shownOnFreshStartup = await hasSessionShown(mockSessionStorage);
  assert.equal(shownOnFreshStartup, false);

  // First new tab of new browser session should intercept:
  const shouldIntercept = shouldInterceptTab({
    url: 'chrome://newtab/',
    hasShownInSession: shownOnFreshStartup,
    isNavigating: false,
    isRecallAlreadyOpen: false,
  });
  assert.equal(shouldIntercept, true);
});
