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
  titleFromDocumentTitle,
} from './lib/tracker.js'
import {
  ERROR_MESSAGES,
  ImportError,
  collectHistory,
  parseSolvedPage,
} from './lib/importer.js'
import { toLocalDay } from './lib/revisionScheduler.js'
import { sendExtensionMessage } from './lib/runtimeMessaging.js'
import { isRevisionSessionUrl } from './lib/revisionSession.js'
import { findEditorToolbar, resetCurrentEditor } from './lib/revisionReset.js'
import {
  recoveryActionFromTarget,
  retrievePreviousCode,
  shouldOfferRecovery,
} from './lib/revisionRecovery.js'

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
  let topics = []
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
        // Best-effort: the problem page may expose topicTags here; if not,
        // topics stays [] and the problem shows under "Other".
        if (Array.isArray(q.topicTags)) topics = q.topicTags
      }

    } catch {
      // malformed JSON — keep document.title fallback
    }
  }
  return { title, difficulty, topics }
}

const REVISION_MODAL_ID = 'recall-revision-modal'
const RECOVERY_CONTROL_ID = 'recall-recovery-control'

function recoveryLog(message, details) {
  if (details === undefined) console.info(`[Recall Recovery] ${message}`)
  else console.info(`[Recall Recovery] ${message}`, details)
}

function recoveryVisibility(host) {
  const view = document.defaultView ?? window
  const style = view.getComputedStyle(host)
  const rect = host.getBoundingClientRect()
  const parent = host.parentElement
  const parentRect = parent?.getBoundingClientRect?.()
  const hiddenAncestors = []
  let clippedAncestor = null
  for (let node = parent; node && node !== document.documentElement; node = node.parentElement) {
    const ancestorStyle = view.getComputedStyle(node)
    const ancestorRect = node.getBoundingClientRect?.()
    if (
      ancestorStyle.display === 'none' ||
      ancestorStyle.visibility === 'hidden' ||
      ancestorStyle.opacity === '0' ||
      ancestorRect?.width === 0 ||
      ancestorRect?.height === 0
    ) {
      hiddenAncestors.push(node)
    }
    if (!clippedAncestor && /(auto|hidden|clip|scroll)/.test(
      `${ancestorStyle.overflow} ${ancestorStyle.overflowX} ${ancestorStyle.overflowY}`,
    )) {
      clippedAncestor = node
    }
  }
  recoveryLog('visibility diagnostics', {
    connected: host.isConnected,
    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    zIndex: style.zIndex,
    parent: parent?.tagName ?? null,
    parentRect: parentRect
      ? { top: parentRect.top, left: parentRect.left, width: parentRect.width, height: parentRect.height }
      : null,
    hiddenAncestors: hiddenAncestors.length,
    clippedAncestor: clippedAncestor?.tagName ?? null,
  })
  return style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    rect.width > 0 &&
    rect.height > 0 &&
    hiddenAncestors.length === 0
}

function editorContentTarget(toolbar) {
  const selectors = '[contenteditable="true"], .monaco-editor, .cm-editor, .view-lines, [data-mode-id]'
  const candidates = [...document.querySelectorAll?.(selectors) ?? []]
  const toolbarAncestors = new Set()
  for (let node = toolbar; node; node = node.parentElement) toolbarAncestors.add(node)

  for (const candidate of candidates) {
    if (candidate === toolbar) continue
    for (let node = candidate; node; node = node.parentElement) {
      if (toolbarAncestors.has(node) && node !== document.body && node !== document.documentElement) {
        return candidate.closest?.('.monaco-editor, .cm-editor, [contenteditable="true"]') ?? candidate
      }
    }
  }
  return null
}

function addRecoveryControl() {
  recoveryLog('creation invoked')
  const existing = document.getElementById(RECOVERY_CONTROL_ID)
  if (existing) {
    recoveryLog('existing host found; duplicate prevented', { connected: existing.isConnected })
    return
  }

  const host = document.createElement('div')
  host.id = RECOVERY_CONTROL_ID
  host.className = 'recall-button-overlay'
  host.style.cssText = [
    'all: initial',
    'display: block',
    'min-width: 0',
    'box-sizing: border-box',
    'margin: 0',
  ].join(';')
  recoveryLog('host created')
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `
    :host {
      --recall-surface: rgba(16, 18, 24, .78);
      --recall-surface-strong: rgba(18, 20, 27, .9);
      --recall-border: rgba(255, 255, 255, .14);
      --recall-text: #f2f3f5;
      --recall-muted: #c7c8ce;
      --recall-focus: #e1c8cc;
      all: initial;
    }
    :host(.recall-button-overlay) {
      position: absolute;
      bottom: 8px;
      left: 16px;
      z-index: 50;
      width: max-content;
      max-width: calc(100% - 32px);
      box-sizing: border-box;
    }
    .recovery {
      display: flex; justify-content: flex-start; align-items: center;
      box-sizing: border-box; width: 100%; max-width: 100%;
      padding: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    button {
      appearance: none; border: 1px solid var(--recall-border);
      border-radius: 8px; padding: 7px 10px; color: var(--recall-text);
      background: var(--recall-surface); box-shadow: 0 8px 24px rgba(0, 0, 0, .2);
      -webkit-backdrop-filter: blur(16px) saturate(125%);
      backdrop-filter: blur(16px) saturate(125%);
      max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      cursor: pointer; font: 12px/1.3 inherit;
    }
    .label { display: block; font-weight: 600; }
    .supporting { display: block; margin-top: 2px; color: var(--recall-muted); font-size: 11px; font-weight: 400; }
    button:hover { background: rgba(255, 255, 255, .14); border-color: rgba(255, 255, 255, .23); }
    button:active { background: rgba(255, 255, 255, .18); }
    button:focus-visible { outline: 2px solid var(--recall-focus); outline-offset: 2px; }
    .recovery-backdrop {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0, 0, 0, .6);
    }
    .dialog {
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 450px; max-width: 90vw; box-sizing: border-box;
      padding: 14px;
      color: var(--recall-text); background: var(--recall-surface-strong);
      border: 1px solid var(--recall-border); border-radius: 10px;
      box-shadow: 0 14px 44px rgba(0, 0, 0, .42);
      -webkit-backdrop-filter: blur(20px) saturate(125%);
      backdrop-filter: blur(20px) saturate(125%);
    }
    h2 { margin: 0 0 7px; font-size: 16px; line-height: 1.25; }
    p { margin: 0 0 12px; color: var(--recall-muted); font-size: 13px; line-height: 1.45; }
    .actions { display: flex; flex-wrap: wrap; gap: 7px; }
    .actions button { font-size: 12px; }
    .close {
      position: absolute; top: 6px; right: 6px;
      border: 0; padding: 2px 6px; background: transparent;
      box-shadow: none; font-size: 18px; line-height: 1;
    }
    .primary { background: rgba(255, 255, 255, .15); }
    .error { color: #e3b8bd; }
  `
  const container = document.createElement('div')
  container.className = 'recovery'
  container.innerHTML = `
    <button type="button" data-action="open" aria-label="Recall Code">
      <span class="label">Recall Code</span>
    </button>
  `
  root.append(style, container)

  const closeDialog = () => {
    const backdrop = root.querySelector('.recovery-backdrop')
    if (backdrop) backdrop.remove()
    root.querySelector('[data-action="open"]')?.focus()
  }
  const showDialog = () => {
    if (root.querySelector('.recovery-backdrop')) return
    const backdrop = document.createElement('div')
    backdrop.className = 'recovery-backdrop'
    const dialog = document.createElement('section')
    dialog.className = 'dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-labelledby', 'recall-recovery-title')
    dialog.innerHTML = `
      <h2 id="recall-recovery-title">Retrieve your previous solution?</h2>
      <p>Retrieving previously submitted code may replace the code currently in your editor. Save or copy any work you want to keep before continuing.</p>
      <div class="actions">
        <button class="primary" type="button" data-action="retrieve">Retrieve Previous Code</button>
        <button type="button" data-action="keep">Keep Practicing</button>
      </div>
    `
    const closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.dataset.action = 'keep'
    closeButton.className = 'close'
    closeButton.setAttribute('aria-label', 'Close')
    closeButton.textContent = '×'
    dialog.prepend(closeButton)
    backdrop.append(dialog)
    container.prepend(backdrop)
    dialog.querySelector('[data-action="retrieve"]').focus()

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) closeDialog()
    })
  }
  const showError = (code) => {
    const messages = {
      'retrieve-not-found': 'Recall could not find LeetCode\'s retrieve-code control. No code was changed.',
      'retrieve-ambiguous': 'Recall found more than one retrieve-code control. No code was changed.',
      'retrieve-disabled': 'LeetCode\'s retrieve-code control is unavailable. No code was changed.',
      'retrieve-hidden': 'LeetCode\'s retrieve-code control is hidden. No code was changed.',
      'retrieve-control-mismatch': 'Recall could not verify the retrieve-code control safely. No code was changed.',
      'retrieve-click-failed': 'LeetCode\'s retrieve-code control could not be activated. No code was changed.',
    }
    const dialog = root.querySelector('.dialog')
    dialog.innerHTML = `
      <h2 id="recall-recovery-title">Previous solution not retrieved</h2>
      <p class="error">${messages[code] ?? 'Recall could not safely retrieve previous code. No code was changed.'}</p>
      <div class="actions"><button type="button" data-action="keep">Keep Practicing</button></div>
    `
    dialog.querySelector('[data-action="keep"]').focus()
  }
  const retrieve = () => {
    const result = retrievePreviousCode(document)
    if (result.status === 'ok') closeDialog()
    else showError(result.code)
  }

  container.addEventListener('click', (event) => {
    const action = recoveryActionFromTarget(event.target)
    if (action === 'open') showDialog()
    if (action === 'keep') closeDialog()
    if (action === 'retrieve') retrieve()
  })
  container.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && root.querySelector('.recovery-backdrop')) closeDialog()
  })

  let lastPlacementState = ''
  const placeHost = (source) => {
    if (host.isConnected) {
      if (lastPlacementState !== 'connected') {
        recoveryLog('host connected', { source })
        recoveryVisibility(host)
        lastPlacementState = 'connected'
      }
      return true
    }

    const toolbarCount = document.querySelectorAll?.('[role="toolbar"]').length ?? 0
    const resetIconCount = document.querySelectorAll?.('svg.fa-arrow-rotate-left').length ?? 0
    const retrieveIconCount = document.querySelectorAll?.('svg.fa-brackets-curly').length ?? 0
    const toolbar = findEditorToolbar(document)
    recoveryLog('placement lookup', {
      source,
      toolbarCount,
      resetIconCount,
      retrieveIconCount,
      toolbarFound: Boolean(toolbar),
    })
    if (!toolbar?.parentNode) {
      if (lastPlacementState !== 'missing-anchor') {
        recoveryLog('placement anchor unavailable; retrying')
        lastPlacementState = 'missing-anchor'
      }
      return false
    }

    const editor = editorContentTarget(toolbar)
    if (editor?.parentNode) {
      const editorPanel = editor.parentNode
      if (document.defaultView?.getComputedStyle?.(editorPanel).position === 'static') {
        editorPanel.style.position = 'relative'
      }
      editorPanel.insertBefore(host, editor)
      recoveryLog('host inserted as editor-relative overlay', {
        connected: host.isConnected,
        anchorPosition: document.defaultView?.getComputedStyle?.(editorPanel).position,
      })
    } else {
      toolbar.parentNode.insertBefore(host, toolbar.nextSibling)
      recoveryLog('editor content anchor unavailable; host inserted after editor toolbar', {
        connected: host.isConnected,
      })
    }
    recoveryVisibility(host)
    lastPlacementState = host.isConnected ? 'connected' : 'insert-failed'
    return host.isConnected
  }

  // LeetCode can replace the editor toolbar's React subtree immediately after
  // the native reset click. Re-find the current toolbar and reinsert the same
  // Recovery host if that render removes its previous parent.
  placeHost('initial')
  let rerenderChecked = false
  const observer = new MutationObserver(() => {
    if (!host.isConnected) {
      recoveryLog('host removed by a later render')
      placeHost('mutation')
    } else if (!rerenderChecked) {
      rerenderChecked = true
      recoveryLog('host remains connected after a later render')
      recoveryVisibility(host)
    }
  })
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true })
    recoveryLog('rerender observer attached')
  } else {
    recoveryLog('rerender observer not attached because document.body is unavailable')
  }

}

function addRevisionModal() {
  const revisionSession = isRevisionSessionUrl(window.location.href)
  recoveryLog('revision session check', { revisionSession })
  if (!revisionSession || document.getElementById(REVISION_MODAL_ID)) return

  const host = document.createElement('div')
  host.id = REVISION_MODAL_ID
  host.style.all = 'initial'
  document.documentElement.append(host)
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `
    :host {
      --recall-surface: rgba(16, 18, 24, .72);
      --recall-surface-strong: rgba(18, 20, 27, .9);
      --recall-border: rgba(255, 255, 255, .14);
      --recall-text: #f2f3f5;
      --recall-muted: #c7c8ce;
      --recall-focus: #e1c8cc;
      all: initial;
    }
    .backdrop {
      position: fixed; inset: 0; z-index: 2147483647;
      display: grid; place-items: center; padding: 20px;
      background: rgba(5, 6, 9, .58);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .dialog {
      width: min(420px, calc(100vw - 40px)); box-sizing: border-box;
      padding: 22px; color: var(--recall-text); background: var(--recall-surface-strong);
      border: 1px solid var(--recall-border); border-radius: 14px;
      box-shadow: 0 18px 60px rgba(0, 0, 0, .5);
      -webkit-backdrop-filter: blur(20px) saturate(125%);
      backdrop-filter: blur(20px) saturate(125%);
    }
    h2 { margin: 0 0 8px; font-size: 20px; line-height: 1.2; }
    p { margin: 0 0 16px; color: var(--recall-muted); font-size: 14px; line-height: 1.5; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    button {
      appearance: none; border: 1px solid var(--recall-border);
      border-radius: 8px; padding: 9px 12px; color: var(--recall-text);
      background: var(--recall-surface); cursor: pointer; font: inherit;
      -webkit-backdrop-filter: blur(14px) saturate(120%);
      backdrop-filter: blur(14px) saturate(120%);
    }
    button:disabled { cursor: not-allowed; opacity: .55; }
    button.primary { background: rgba(255, 255, 255, .15); }
    button:hover { background: rgba(255, 255, 255, .14); border-color: rgba(255, 255, 255, .23); }
    button.primary:hover { background: rgba(255, 255, 255, .2); }
    button:focus-visible { outline: 2px solid var(--recall-focus); outline-offset: 2px; }
    .notice { margin-top: 14px; padding: 10px; border-radius: 8px; background: rgba(255, 255, 255, .07); border: 1px solid rgba(255, 255, 255, .08); }
    .notice p { margin-bottom: 10px; font-size: 13px; }
    .error { color: #e3b8bd; }
  `
  const backdrop = document.createElement('div')
  backdrop.className = 'backdrop'
  backdrop.innerHTML = `
    <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="recall-revision-title">
      <h2 id="recall-revision-title">Ready to revise this problem?</h2>
      <p>Try solving it independently or review your previous approach.</p>
      <div class="actions">
        <button class="primary" type="button" data-action="fresh">Start Fresh Attempt</button>
        <button type="button" data-action="previous">See Previous Code</button>
        <button type="button" data-action="continue">Continue with current editor</button>
      </div>
    </section>
  `
  root.append(style, backdrop)

  const close = () => host.remove()
  const showConfirmation = () => {
    const dialog = root.querySelector('.dialog')
    dialog.innerHTML = `
      <h2 id="recall-revision-title">Replace the current draft?</h2>
      <p class="notice">LeetCode's native reset restores the default code definition for the selected language and may replace its current draft. Recall will not submit code or affect other languages.</p>
      <div class="actions">
        <button class="primary" type="button" data-action="confirm-reset">Reset to default code</button>
        <button type="button" data-action="cancel-reset">Cancel</button>
      </div>
    `
    root.querySelector('[data-action="confirm-reset"]').focus()
  }
  const showResetError = (code) => {
    const messages = {
      'document-unavailable': 'The LeetCode page is not ready. No code was changed.',
      'reset-not-found': 'Recall could not find LeetCode\'s native reset control. No code was changed.',
      'reset-ambiguous': 'Recall found more than one possible reset control. No code was changed.',
      'reset-disabled': 'LeetCode\'s native reset control is unavailable. No code was changed.',
      'reset-control-mismatch': 'Recall could not verify the reset control safely. No code was changed.',
      'reset-click-failed': 'LeetCode’s native reset control could not be activated. No code was changed.',
    }
    const dialog = root.querySelector('.dialog')
    dialog.innerHTML = `
      <h2 id="recall-revision-title">Fresh attempt not started</h2>
      <p class="error">${messages[code] ?? 'Recall could not safely reset the editor. No code was changed.'}</p>
      <div class="actions">
        <button type="button" data-action="previous">See Previous Code</button>
        <button type="button" data-action="continue">Continue with current editor</button>
      </div>
    `
    root.querySelector('[data-action="continue"]').focus()
  }
  const confirmReset = () => {
    const result = resetCurrentEditor(document)
    recoveryLog('native reset result', { status: result.status, code: result.code })
    if (shouldOfferRecovery(result)) {
      addRecoveryControl()
      close()
    }
    else showResetError(result.code)
  }

  backdrop.addEventListener('click', (event) => {
    const action = event.target?.dataset?.action
    if (action === 'previous' || action === 'continue') close()
    if (action === 'fresh') showConfirmation()
    if (action === 'confirm-reset') confirmReset()
    if (action === 'cancel-reset') {
      const dialog = root.querySelector('.dialog')
      dialog.innerHTML = `
        <h2 id="recall-revision-title">Ready to revise this problem?</h2>
        <p>Try solving it independently or review your previous approach.</p>
        <div class="actions">
          <button class="primary" type="button" data-action="fresh">Start Fresh Attempt</button>
          <button type="button" data-action="previous">See Previous Code</button>
          <button type="button" data-action="continue">Continue with current editor</button>
        </div>
      `
      root.querySelector('[data-action="fresh"]').focus()
    }
  })
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close()
  })

  root.querySelector('[data-action="fresh"]').focus()
}

addRevisionModal()

async function recordAccepted(slug) {
  const { title, difficulty, topics } = pageMeta()
  try {
    console.info('[Recall content] accepted verdict detected; sending record request', slug)
    const response = await sendExtensionMessage(chrome.runtime, {
      type: 'RECALL_RECORD_ACCEPTED',
      event: {
        problemId: slug,
        title,
        difficulty,
        topics,
        at: new Date().toISOString(),
      },
    })
    if (response?.status !== 'ok') throw new Error(response?.message ?? 'Storage operation failed.')
    console.info(`[Recall content] accepted submission saved: ${slug}`)
  } catch (err) {
    console.warn('[Recall content] failed to save submission', err?.message ?? err)
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
    questions { titleSlug title difficulty topicTags { name slug } }
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
  collectHistory({
    fetchPage: fetchSolvedPage,
    onProgress: (p) => {
      try {
        chrome.runtime.sendMessage({ type: 'RECALL_SYNC_PROGRESS', ...p }, () => void chrome.runtime.lastError)
      } catch {
        // popup closed mid-sync - the import still finishes and is saved
      }
    },
  })
    .then(async (result) => {
      if (result.status === 'error') return result
      const merged = await sendExtensionMessage(chrome.runtime, {
        type: 'RECALL_MERGE_HISTORY',
        questions: result.questions,
        importStatus: result.status,
        totalNum: result.totalNum,
        todayDay: toLocalDay(new Date()),
      })
      if (merged?.status !== 'ok') {
        return { status: 'error', code: 'storage', message: merged?.message ?? ERROR_MESSAGES.storage }
      }
      return {
        status: merged.importStatus,
        totalNum: merged.totalNum,
        stats: merged.stats,
        problems: merged.problems,
      }
    })
    .then(sendResponse)
    .catch(() => sendResponse({ status: 'error', code: 'unknown', message: ERROR_MESSAGES.unknown }))
    .finally(() => {
      syncing = false
    })
  return true // async response
})
