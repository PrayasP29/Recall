export const RESET_LABEL = 'Reset to default code definition'
export const RETRIEVE_LABEL = 'Retrieve last submitted code'
export const RESET_ICON = 'fa-arrow-rotate-left'
export const RETRIEVE_ICON = 'fa-brackets-curly'

export function hasIcon(element, iconClass) {
  return Boolean(element.querySelector?.(`svg.${iconClass}`))
}

export function toolbarControls(document) {
  if (!document?.querySelectorAll) return []
  const toolbars = document.querySelectorAll('[role="toolbar"]')
  const semanticControls = [...new Set(
    [...toolbars].flatMap((toolbar) => [
      ...toolbar.querySelectorAll?.('button,[role="button"]') ?? [],
    ]),
  )]
  if (semanticControls.length) return semanticControls

  const allControls = [...document.querySelectorAll('button,[role="button"]')]
  const reset = allControls.filter((control) => hasIcon(control, RESET_ICON))
  const retrieve = allControls.filter((control) => hasIcon(control, RETRIEVE_ICON))
  if (reset.length !== 1 || retrieve.length !== 1) return []

  const ancestors = new Set()
  for (let node = reset[0]; node; node = node.parentElement) ancestors.add(node)
  for (let node = retrieve[0]; node; node = node.parentElement) {
    if (ancestors.has(node) && node !== document.body && node !== document.documentElement) {
      return [...node.querySelectorAll?.('button,[role="button"]') ?? []]
    }
  }
  return []
}

export function findEditorToolbar(document) {
  if (!document?.querySelectorAll) return null
  const toolbars = [...document.querySelectorAll('[role="toolbar"]')]
  const matchingToolbars = toolbars.filter((toolbar) => {
    const controls = [...toolbar.querySelectorAll?.('button,[role="button"]') ?? []]
    return controls.filter((control) => hasIcon(control, RESET_ICON)).length === 1 &&
      controls.filter((control) => hasIcon(control, RETRIEVE_ICON)).length === 1
  })
  if (matchingToolbars.length === 1) return matchingToolbars[0]

  const controls = [...document.querySelectorAll('button,[role="button"]')]
  const reset = controls.filter((control) => hasIcon(control, RESET_ICON))
  const retrieve = controls.filter((control) => hasIcon(control, RETRIEVE_ICON))
  if (reset.length !== 1 || retrieve.length !== 1) return null

  const ancestors = new Set()
  for (let node = reset[0]; node; node = node.parentElement) ancestors.add(node)
  for (let node = retrieve[0]; node; node = node.parentElement) {
    if (ancestors.has(node) && node !== document.body && node !== document.documentElement) return node
  }
  return null
}

export function isVisible(element, document) {
  if (element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false
  if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false
  const style = document.defaultView?.getComputedStyle?.(element)
  return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0')
}

export function findResetControl(document) {
  const controls = toolbarControls(document)
  if (!controls.length) return { status: 'error', code: 'reset-not-found', resetCount: 0, retrieveCount: 0 }

  const retrieve = controls.filter((control) => hasIcon(control, RETRIEVE_ICON))
  const reset = controls.filter(
    (control) => hasIcon(control, RESET_ICON) && !hasIcon(control, RETRIEVE_ICON),
  )

  if (reset.length !== 1) {
    return {
      status: 'error',
      code: reset.length === 0 ? 'reset-not-found' : 'reset-ambiguous',
      resetCount: reset.length,
      retrieveCount: retrieve.length,
    }
  }

  return { status: 'ok', element: reset[0], retrieveCount: retrieve.length }
}

export function resetCurrentEditor(document) {
  const result = findResetControl(document)
  if (result.status !== 'ok') return result

  const control = result.element
  if (
    control.disabled ||
    control.getAttribute?.('aria-disabled') === 'true' ||
    !isVisible(control, document)
  ) {
    return { status: 'error', code: control.disabled || control.getAttribute?.('aria-disabled') === 'true' ? 'reset-disabled' : 'reset-hidden' }
  }
  if (!hasIcon(control, RESET_ICON) || hasIcon(control, RETRIEVE_ICON)) {
    return { status: 'error', code: 'reset-control-mismatch' }
  }

  try {
    control.click()
    return { status: 'ok' }
  } catch {
    return { status: 'error', code: 'reset-click-failed' }
  }
}
