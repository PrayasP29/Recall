// Cross-browser WebExtensions API wrapper.
// Normalizes access across Chrome, Edge, Brave, Opera, Firefox, and Safari.
// Supports both Promise-based (browser.*) and callback/hybrid (chrome.*) implementations.

/**
 * Resolves the global browser extension namespace.
 * In Firefox and Safari, `globalThis.browser` is standard.
 * In Chromium (Chrome, Edge, Brave, Opera), `globalThis.chrome` is provided.
 */
export function getBrowserAPI() {
  if (typeof globalThis.browser !== 'undefined' && globalThis.browser?.runtime) {
    return globalThis.browser;
  }
  if (typeof globalThis.chrome !== 'undefined' && globalThis.chrome?.runtime) {
    return globalThis.chrome;
  }
  return null;
}

/**
 * In-memory fallback session storage for environments where chrome.storage.session
 * is not natively enabled (e.g. unit tests or older engines).
 */
const inMemorySessionStore = new Map();

const fallbackSessionStorage = {
  async get(keys) {
    if (typeof keys === 'string') {
      return { [keys]: inMemorySessionStore.get(keys) };
    }
    if (Array.isArray(keys)) {
      const result = {};
      for (const k of keys) {
        if (inMemorySessionStore.has(k)) result[k] = inMemorySessionStore.get(k);
      }
      return result;
    }
    if (keys && typeof keys === 'object') {
      const result = { ...keys };
      for (const k of Object.keys(keys)) {
        if (inMemorySessionStore.has(k)) result[k] = inMemorySessionStore.get(k);
      }
      return result;
    }
    const all = {};
    for (const [k, v] of inMemorySessionStore.entries()) {
      all[k] = v;
    }
    return all;
  },
  async set(items) {
    for (const [k, v] of Object.entries(items ?? {})) {
      inMemorySessionStore.set(k, v);
    }
  },
  async remove(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) {
      inMemorySessionStore.delete(k);
    }
  },
  async clear() {
    inMemorySessionStore.clear();
  },
};

/**
 * Normalizes a StorageArea object so that get/set/remove/clear always return
 * Promises regardless of whether the browser natively uses callbacks or Promises.
 */
function wrapStorageArea(rawArea) {
  if (!rawArea) return null;
  return {
    get(keys) {
      return new Promise((resolve) => {
        try {
          const res = rawArea.get(keys, (data) => {
            const lastError = globalThis.chrome?.runtime?.lastError;
            if (lastError) {
              console.warn('[Recall storage] get error', lastError);
              resolve({});
            } else {
              resolve(data ?? {});
            }
          });
          if (res && typeof res.then === 'function') {
            res.then((data) => resolve(data ?? {})).catch(() => resolve({}));
          }
        } catch {
          resolve({});
        }
      });
    },
    set(items) {
      return new Promise((resolve) => {
        try {
          const res = rawArea.set(items, () => {
            resolve();
          });
          if (res && typeof res.then === 'function') {
            res.then(resolve).catch(resolve);
          }
        } catch {
          resolve();
        }
      });
    },
    remove(keys) {
      return new Promise((resolve) => {
        try {
          const res = rawArea.remove(keys, () => {
            resolve();
          });
          if (res && typeof res.then === 'function') {
            res.then(resolve).catch(resolve);
          }
        } catch {
          resolve();
        }
      });
    },
    clear() {
      return new Promise((resolve) => {
        try {
          const res = rawArea.clear(() => {
            resolve();
          });
          if (res && typeof res.then === 'function') {
            res.then(resolve).catch(resolve);
          }
        } catch {
          resolve();
        }
      });
    },
  };
}

/**
 * Retrieves the requested storage area ('local', 'session', or 'sync').
 * Safely falls back if storage.session is unsupported.
 *
 * @param {'local'|'session'|'sync'} [area='local']
 * @returns {Object|null}
 */
export function getStorageArea(area = 'local') {
  const api = getBrowserAPI();
  if (!api?.storage) return null;

  if (area === 'session') {
    if (api.storage.session) {
      return wrapStorageArea(api.storage.session);
    }
    return fallbackSessionStorage;
  }

  return wrapStorageArea(api.storage[area]) ?? null;
}

/**
 * Returns extension URL for an asset path.
 *
 * @param {string} path
 * @returns {string}
 */
export function getExtensionUrl(path) {
  const api = getBrowserAPI();
  if (api?.runtime?.getURL) {
    return api.runtime.getURL(path);
  }
  return path;
}
