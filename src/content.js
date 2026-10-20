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
