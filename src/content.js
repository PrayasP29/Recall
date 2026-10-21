// Recall content script — records accepted LeetCode submissions.
// Bundled by Vite to dist/content.js and registered in manifest.json.
//
// Detection model (evidence-based, see report):
//   1. Arm on a real Submit click (capture phase, button text "Submit").
//      Visiting a page never arms, so stale results never create records.
//   2. Watch DOM mutations for an EXACT verdict text match ("Accepted",
//      "Wrong Answer", ...) inside newly added nodes or changed text.
//   3. Disarm after the first final verdict — repeated mutations for the
//      same submission are ignored, and a re-solve re-arms via a new click.
import {
  classifyVerdict,
  slugFromPathname,
  normalizeProblemUrl,
  titleFromDocumentTitle,
  upsertProblem,
} from './lib/tracker.js'
import {
  ERROR_MESSAGES,
  ImportError,
  parseSolvedPage,
  syncHistory,
} from './lib/importer.js'

const ARM_WINDOW_MS = 30_000 // verdict usually lands within seconds; contests queue

let armed = null // { slug, until } | null

function arm() {
  const slug = slugFromPathname(window.location.pathname)
  if (!slug) return
  armed = { slug, until: Date.now() + ARM_WINDOW_MS }
}

document.addEventListener(
  'click',
  (e) => {
    let el = e.target
    for (let i = 0; el && i < 3; i++, el = el.parentElement) {
      if (el.tagName === 'BUTTON' && el.textContent.trim().toLowerCase() === 'submit') {
        arm()
        return
      }
    }
  },
  true,
)

// Exact verdict text among nodes that were just added or changed.
function findVerdict(records) {
  for (const rec of records) {
    if (rec.type === 'characterData') {
      const v = classifyVerdict(rec.target.textContent)
      if (v) return v
      continue
    }
    for (const node of rec.addedNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const v = classifyVerdict(node.textContent)
        if (v) return v
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
        let t
        while ((t = walker.nextNode())) {
          const v = classifyVerdict(t.textContent)
          if (v) return v
        }
      }
    }
  }
  return null
}

// Best-effort metadata; any miss falls back to null / document.title.
function pageMeta() {
  let title = titleFromDocumentTitle(document.title)
  let difficulty = null
  const el = document.querySelector('script#__NEXT_DATA__')
  if (el) {
    try {
      const pp = JSON.parse(el.textContent)?.props?.pageProps
      const q =
        pp?.dehydratedState?.queries?.find((x) => x?.state?.data?.question)?.state?.data
          ?.question ??
        pp?.question ??
        pp?.data?.question
      if (q && typeof q === 'object') {
        if (typeof q.title === 'string' && q.title) title = q.title
        if (['Easy', 'Medium', 'Hard'].includes(q.difficulty)) difficulty = q.difficulty
      }
    } catch {
      // malformed JSON — keep document.title fallback
    }
  }
  return { title, difficulty }
}

async function recordAccepted(slug) {
  const { title, difficulty } = pageMeta()
  try {
    // ponytail: read-modify-write on one key; single armed tab means one
    // writer today. Multi-tab concurrent solves would need a queue (or a
    // background worker) to avoid clobbering — upgrade if that ever happens.
    const { problems = {} } = await chrome.storage.local.get('problems')
    problems[slug] = upsertProblem(problems[slug], {
      problemId: slug,
      url: normalizeProblemUrl(slug),
      title,
      difficulty,
      at: new Date().toISOString(),
    })
    await chrome.storage.local.set({ problems })
    console.info(`[Recall] recorded accepted submission: ${slug}`)
  } catch (err) {
    console.warn('[Recall] failed to save submission', err)
  }
}

new MutationObserver((records) => {
  if (!armed) return
  if (Date.now() > armed.until || slugFromPathname(window.location.pathname) !== armed.slug) {
    armed = null
    return
  }
  const verdict = findVerdict(records)
  if (!verdict) return
  const slug = armed.slug
  armed = null // disarm: one final verdict per Submit; repeats ignored
  if (verdict === 'accepted') recordAccepted(slug)
}).observe(document.documentElement, { childList: true, subtree: true, characterData: true })

// --- History sync ---------------------------------------------------------
// Runs only in this page's origin, so the logged-in session cookies apply.
// The csrftoken cookie is read locally and sent only to leetcode.com; it is
// never logged or stored.

const SOLVED_QUERY = `query userProgressQuestionList($filters: UserProgressQuestionListInput) {
  userProgressQuestionList(filters: $filters) {
    totalNum
    questions { titleSlug title difficulty }
  }
}`

function csrfToken() {
  const m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie)
  return m ? decodeURIComponent(m[1]) : null
}

async function fetchSolvedPage(skip, limit) {
  const csrf = csrfToken()
  if (!csrf) throw new ImportError('auth') // not logged in / cookie unavailable
  let res
  try {
    res = await fetch('https://leetcode.com/graphql/', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-csrftoken': csrf },
      body: JSON.stringify({
        query: SOLVED_QUERY,
        variables: { filters: { questionStatus: 'SOLVED', skip, limit } },
      }),
    })
  } catch {
    throw new ImportError('network', { retryable: true })
  }
  if (res.status === 401 || res.status === 403) throw new ImportError('auth')
  if (res.status === 429 || res.status >= 500) throw new ImportError('http', { retryable: true })
  let json
  try {
    json = await res.json()
  } catch {
    throw new ImportError('invalid')
  }
  return parseSolvedPage(res.status, json)
}

let syncing = false

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only this extension's popup may trigger a sync; ignore unknown messages.
  if (msg?.type !== 'RECALL_SYNC_HISTORY' || sender?.id !== chrome.runtime.id) return
  if (syncing) {
    sendResponse({ status: 'error', code: 'busy', message: ERROR_MESSAGES.busy })
    return
  }
  syncing = true
  syncHistory({
    fetchPage: fetchSolvedPage,
    // ponytail: same single-writer assumption as recordAccepted() above.
    // Concurrent sync + verdict writes would need a queue; upgrade if that
    // becomes a real scenario.
    loadProblems: async () => (await chrome.storage.local.get('problems')).problems ?? {},
    saveProblems: (problems) => chrome.storage.local.set({ problems }),
    onProgress: (p) => {
      try {
        chrome.runtime.sendMessage({ type: 'RECALL_SYNC_PROGRESS', ...p }, () => void chrome.runtime.lastError)
      } catch {
        // popup closed mid-sync - the import still finishes and is saved
      }
    },
  })
    .then(sendResponse)
    .catch(() => sendResponse({ status: 'error', code: 'unknown', message: ERROR_MESSAGES.unknown }))
    .finally(() => {
      syncing = false
    })
  return true // async response
})
