import test from 'node:test'
import assert from 'node:assert/strict'
import {
  findResetControl,
  findEditorToolbar,
  resetCurrentEditor,
  RESET_ICON,
  RETRIEVE_ICON,
} from './revisionReset.js'

function svg(iconClass) {
  return { iconClass }
}

function element(iconClass, options = {}) {
  let clicks = 0
  const icon = svg(iconClass)
  return {
    disabled: Boolean(options.disabled),
    hidden: Boolean(options.hidden),
    getClientRects: () => (options.visible === false ? [] : [{}]),
    getAttribute(name) {
      if (name === 'aria-disabled') return options.ariaDisabled ? 'true' : null
      if (name === 'aria-hidden') return options.ariaHidden ? 'true' : null
      return null
    },
    querySelector(selector) {
      return selector === `svg.${iconClass}` ? icon : null
    },
    click() {
      clicks += 1
      if (options.throwOnClick) throw new Error('click failed')
    },
    get clicks() {
      return clicks
    },
  }
}

function documentOf(toolbarElements, options = {}) {
  const toolbar = {
    querySelectorAll: () => toolbarElements,
  }
  return {
    body: options.body,
    documentElement: options.documentElement,
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === '[role="toolbar"]') return options.noSemanticToolbar ? [] : [toolbar]
      return options.allControls ?? []
    },
  }
}

test('identifies the reset button by its SVG icon inside the editor toolbar', () => {
  const reset = element(RESET_ICON)
  const retrieve = element(RETRIEVE_ICON)
  assert.equal(findResetControl(documentOf([reset, retrieve])).element, reset)
  assert.deepEqual(resetCurrentEditor(documentOf([reset, retrieve])), { status: 'ok' })
  assert.equal(reset.clicks, 1)
  assert.equal(retrieve.clicks, 0)
})

test('rejects the retrieve-code button and never clicks it', () => {
  const retrieve = element(RETRIEVE_ICON)
  const result = resetCurrentEditor(documentOf([retrieve]))
  assert.equal(result.code, 'reset-not-found')
  assert.equal(retrieve.clicks, 0)
})

test('rejects a reset candidate that also contains the retrieve icon', () => {
  const both = element(RESET_ICON)
  both.querySelector = (selector) => selector === `svg.${RESET_ICON}` || selector === `svg.${RETRIEVE_ICON}` ? svg(selector.slice(4, -1)) : null
  assert.equal(resetCurrentEditor(documentOf([both])).code, 'reset-not-found')
  assert.equal(both.clicks, 0)
})

test('refuses multiple, missing, disabled, and hidden reset controls', () => {
  const first = element(RESET_ICON)
  const second = element(RESET_ICON)
  assert.equal(resetCurrentEditor(documentOf([first, second])).code, 'reset-ambiguous')
  assert.equal(first.clicks, 0)

  assert.equal(resetCurrentEditor(documentOf([])).code, 'reset-not-found')

  const disabled = element(RESET_ICON, { disabled: true })
  assert.equal(resetCurrentEditor(documentOf([disabled])).code, 'reset-disabled')
  assert.equal(disabled.clicks, 0)

  const hidden = element(RESET_ICON, { visible: false })
  assert.equal(resetCurrentEditor(documentOf([hidden])).code, 'reset-hidden')
  assert.equal(hidden.clicks, 0)
})

test('does not click a reset control outside a toolbar', () => {
  const reset = element(RESET_ICON)
  const document = {
    querySelectorAll: () => [],
  }
  assert.equal(resetCurrentEditor(document).code, 'reset-not-found')
  assert.equal(reset.clicks, 0)
})

test('uses the reset and retrieve buttons common ancestor when toolbar role is absent', () => {
  const reset = element(RESET_ICON)
  const retrieve = element(RETRIEVE_ICON)
  const toolbar = {
    querySelectorAll: () => [reset, retrieve],
  }
  reset.parentElement = toolbar
  retrieve.parentElement = toolbar
  const document = documentOf([], {
    noSemanticToolbar: true,
    allControls: [reset, retrieve],
  })

  test('finds the dedicated editor toolbar containing both native controls', () => {
    const reset = element(RESET_ICON)
    const retrieve = element(RETRIEVE_ICON)
    const toolbar = { querySelectorAll: () => [reset, retrieve] }
    const document = documentOf([reset, retrieve])
    document.querySelectorAll = (selector) => selector === '[role="toolbar"]' ? [toolbar] : []
    assert.equal(findEditorToolbar(document), toolbar)
  })
  assert.deepEqual(resetCurrentEditor(document), { status: 'ok' })
  assert.equal(reset.clicks, 1)
  assert.equal(retrieve.clicks, 0)
})
