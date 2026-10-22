import test from 'node:test'
import assert from 'node:assert/strict'
import {
  retrievePreviousCode,
  findRetrieveControl,
  shouldOfferRecovery,
  recoveryActionFromTarget,
} from './revisionRecovery.js'
import { RESET_ICON, RETRIEVE_ICON } from './revisionReset.js'

function iconControl(iconClass, options = {}) {
  let clicks = 0
  return {
    disabled: Boolean(options.disabled),
    getClientRects: () => (options.visible === false ? [] : [{}]),
    getAttribute: (name) => name === 'aria-disabled' && options.ariaDisabled ? 'true' : null,
    querySelector: (selector) => selector === `svg.${iconClass}` ? {} : null,
    click: () => {
      clicks += 1
      if (options.throwOnClick) throw new Error('click failed')
    },
    get clicks() {
      return clicks
    },
  }
}

function documentOf(controls) {
  const toolbar = { querySelectorAll: () => controls }
  return {
    defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) },
    querySelectorAll: (selector) => selector === '[role="toolbar"]' ? [toolbar] : [],
  }
}

test('identifies and triggers only the retrieve-code control', () => {
  const reset = iconControl(RESET_ICON)
  const retrieve = iconControl(RETRIEVE_ICON)
  const document = documentOf([reset, retrieve])
  assert.equal(findRetrieveControl(document).element, retrieve)
  assert.deepEqual(retrievePreviousCode(document), { status: 'ok' })
  assert.equal(retrieve.clicks, 1)
  assert.equal(reset.clicks, 0)
})

test('recovery is offered only after a successful reset initiation', () => {
  assert.equal(shouldOfferRecovery({ status: 'ok' }), true)
  assert.equal(shouldOfferRecovery({ status: 'error', code: 'reset-not-found' }), false)
  assert.equal(shouldOfferRecovery(null), false)
})

test('recovery action resolves clicks on the rendered button and its label', () => {
  const button = { dataset: { action: 'open' } }
  const label = {
    dataset: {},
    closest: () => button,
  }
  assert.equal(recoveryActionFromTarget(button), 'open')
  assert.equal(recoveryActionFromTarget(label), 'open')
  assert.equal(recoveryActionFromTarget({ dataset: {} }), null)
})

test('fails safely for missing, ambiguous, disabled, and hidden retrieval controls', () => {
  assert.equal(retrievePreviousCode(documentOf([])).code, 'retrieve-not-found')
  const first = iconControl(RETRIEVE_ICON)
  const second = iconControl(RETRIEVE_ICON)
  assert.equal(retrievePreviousCode(documentOf([first, second])).code, 'retrieve-ambiguous')
  assert.equal(first.clicks, 0)

  const disabled = iconControl(RETRIEVE_ICON, { disabled: true })
  assert.equal(retrievePreviousCode(documentOf([disabled])).code, 'retrieve-disabled')
  assert.equal(disabled.clicks, 0)

  const hidden = iconControl(RETRIEVE_ICON, { visible: false })
  assert.equal(retrievePreviousCode(documentOf([hidden])).code, 'retrieve-hidden')
  assert.equal(hidden.clicks, 0)
})

test('rejects a control containing both reset and retrieve icons', () => {
  const both = iconControl(RETRIEVE_ICON)
  both.querySelector = (selector) => selector === `svg.${RETRIEVE_ICON}` || selector === `svg.${RESET_ICON}` ? {} : null
  assert.equal(retrievePreviousCode(documentOf([both])).code, 'retrieve-not-found')
  assert.equal(both.clicks, 0)
})
