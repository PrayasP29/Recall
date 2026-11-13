// Pure once-per-session management logic.
// Ensures Recall appears exactly once per browser session on the first new tab,
// and subsequent new tabs display the browser's native new tab page.
//
// Key attributes:
// - Dual-layer protection: Synchronous in-memory latch + persistent session storage.
// - Survives extension background service worker suspension (via session-scoped storage).
// - Automatically resets when the browser session ends / browser restarts.
// - Concurrency-locked: opening multiple tabs at startup never creates duplicates.
// - Works across Chromium (Chrome, Edge, Brave, Opera), Firefox, and Safari.

export const RECALL_SESSION_SHOWN_KEY = 'recall_session_shown';

let inMemoryShown = false;

/**
 * Reads the synchronous in-memory session flag.
 *
 * @returns {boolean}
 */
export function getSessionShownInMemory() {
  return inMemoryShown;
}

/**
 * Sets the synchronous in-memory session flag.
 *
 * @param {boolean} value
 */
export function setSessionShownInMemory(value) {
  inMemoryShown = Boolean(value);
}

/**
 * Checks whether a URL represents an instance of Recall's new tab page.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isRecallUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.includes('newtab.html') || url.endsWith('/newtab.html');
}

/**
 * Checks whether a URL represents a browser's native default new tab page.
 *
 * Covers:
 * - Chrome / Chromium: 'chrome://newtab/', 'chrome://newtab', 'chrome://new-tab-page'
 * - Microsoft Edge: 'edge://newtab/', 'edge://newtab'
 * - Mozilla Firefox: 'about:newtab', 'about:home'
 * - Safari: '', 'favorites://', 'safari-resource:/startPage.html'
 * - Initial blank state: '', 'about:blank'
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isNativeNewTabUrl(url) {
  if (!url || typeof url !== 'string') return true; // empty initial URL on creation is native
  const trimmed = url.trim().toLowerCase();

  return (
    trimmed === '' ||
    trimmed === 'about:blank' ||
    trimmed === 'about:newtab' ||
    trimmed === 'about:newtab/' ||
    trimmed === 'about:home' ||
    trimmed === 'about:home/' ||
    trimmed.startsWith('chrome://newtab') ||
    trimmed.startsWith('chrome://new-tab-page') ||
    trimmed.startsWith('chrome-search://') ||
    trimmed.startsWith('edge://newtab') ||
    trimmed.startsWith('brave://newtab') ||
    trimmed.startsWith('opera://startpage') ||
    trimmed.startsWith('favorites://') ||
    trimmed.includes('startpage.html')
  );
}

/**
 * Checks if Recall has already been shown during the current browser session.
 * Checks the fast in-memory latch first, then falls back to session storage.
 *
 * @param {Object} sessionStorage - Storage area (chrome.storage.session or fallback)
 * @returns {Promise<boolean>}
 */
export async function hasSessionShown(sessionStorage) {
  if (inMemoryShown) {
    return true;
  }
  if (!sessionStorage || typeof sessionStorage.get !== 'function') {
    return false;
  }
  try {
    const res = await sessionStorage.get([RECALL_SESSION_SHOWN_KEY]);
    const shown = Boolean(res?.[RECALL_SESSION_SHOWN_KEY]);
    if (shown) {
      inMemoryShown = true;
    }
    return shown;
  } catch {
    return false;
  }
}

/**
 * Marks Recall as having been displayed for the current browser session.
 * Updates both the in-memory latch immediately and persists to session storage.
 *
 * @param {Object} sessionStorage
 * @returns {Promise<void>}
 */
export async function markSessionShown(sessionStorage) {
  inMemoryShown = true;
  if (!sessionStorage || typeof sessionStorage.set !== 'function') {
    return;
  }
  try {
    await sessionStorage.set({ [RECALL_SESSION_SHOWN_KEY]: true });
  } catch (err) {
    console.warn('[Recall sessionManager] failed to mark session shown', err);
  }
}

/**
 * Resets the session state (called on fresh startup if needed).
 *
 * @param {Object} sessionStorage
 * @returns {Promise<void>}
 */
export async function resetSessionState(sessionStorage) {
  inMemoryShown = false;
  if (!sessionStorage) return;
  try {
    if (typeof sessionStorage.remove === 'function') {
      await sessionStorage.remove([RECALL_SESSION_SHOWN_KEY]);
    } else if (typeof sessionStorage.clear === 'function') {
      await sessionStorage.clear();
    }
  } catch (err) {
    console.warn('[Recall sessionManager] failed to reset session state', err);
  }
}

/**
 * Pure evaluation determining whether a newly created or updated tab should
 * be navigated to Recall.
 *
 * @param {Object} params
 * @param {string} [params.url]
 * @param {string} [params.pendingUrl]
 * @param {boolean} params.hasShownInSession - true if already shown this session
 * @param {boolean} params.isNavigating - true if another tab is currently being directed
 * @param {boolean} params.isRecallAlreadyOpen - true if a Recall tab is already open
 * @returns {boolean}
 */
export function shouldInterceptTab({
  url = '',
  pendingUrl = '',
  hasShownInSession = false,
  isNavigating = false,
  isRecallAlreadyOpen = false,
}) {
  // If Recall has already been shown this browser session, allow native new tab
  if (hasShownInSession) return false;

  // Concurrency lock: do not intercept if another tab is actively navigating to Recall
  if (isNavigating) return false;

  // Duplicate prevention: do not open if Recall is already open in any window
  if (isRecallAlreadyOpen) return false;

  const targetUrl = pendingUrl || url || '';

  // If already navigating to Recall, no redirection needed
  if (isRecallUrl(targetUrl)) return false;

  // Intercept if the tab is intended as a new tab
  return isNativeNewTabUrl(targetUrl);
}
