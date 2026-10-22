import {
  hasIcon,
  isVisible,
  RETRIEVE_ICON,
  RESET_ICON,
  toolbarControls,
} from './revisionReset.js'

export function shouldOfferRecovery(resetResult) {
  return resetResult?.status === 'ok'
}

export function recoveryActionFromTarget(target) {
  return target?.closest?.('[data-action]')?.dataset?.action ??
    target?.dataset?.action ??
    null
}

export function findRetrieveControl(document) {
  const controls = toolbarControls(document)
  const retrieve = controls.filter(
    (control) => hasIcon(control, RETRIEVE_ICON) && !hasIcon(control, RESET_ICON),
  )
  if (retrieve.length !== 1) {
    return {
      status: 'error',
      code: retrieve.length === 0 ? 'retrieve-not-found' : 'retrieve-ambiguous',
      retrieveCount: retrieve.length,
    }
  }
  return { status: 'ok', element: retrieve[0] }
}

export function retrievePreviousCode(document) {
  const result = findRetrieveControl(document)
  if (result.status !== 'ok') return result

  const control = result.element
  if (
    control.disabled ||
    control.getAttribute?.('aria-disabled') === 'true' ||
    !isVisible(control, document)
  ) {
    return {
      status: 'error',
      code: control.disabled || control.getAttribute?.('aria-disabled') === 'true'
        ? 'retrieve-disabled'
        : 'retrieve-hidden',
    }
  }
  if (hasIcon(control, RESET_ICON) || !hasIcon(control, RETRIEVE_ICON)) {
    return { status: 'error', code: 'retrieve-control-mismatch' }
  }

  try {
    control.click()
    return { status: 'ok' }
  } catch {
    return { status: 'error', code: 'retrieve-click-failed' }
  }
}
