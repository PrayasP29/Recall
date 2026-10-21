// Send an extension message while preserving callback-based runtime errors.
export function sendExtensionMessage(runtime, message) {
  if (!runtime || typeof runtime.sendMessage !== 'function') {
    return Promise.reject(new Error('Extension messaging API unavailable.'))
  }

  console.info('[Recall messaging] send attempted', message?.type ?? 'unknown')
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback) => (value) => {
      if (settled) return
      settled = true
      callback(value)
    }
    const resolveOnce = finish(resolve)
    const rejectOnce = finish(reject)

    try {
      const result = runtime.sendMessage(message, (response) => {
        const lastError = runtime.lastError
        if (lastError) {
          console.warn('[Recall messaging] send failed', lastError.message || 'unknown runtime error')
          rejectOnce(new Error(lastError.message || 'Extension message failed.'))
          return
        }
        console.info('[Recall messaging] response received', message?.type ?? 'unknown')
        resolveOnce(response)
      })
      if (result && typeof result.then === 'function') {
        result.then(resolveOnce, rejectOnce)
      }
    } catch (error) {
      console.warn('[Recall messaging] send threw', error?.message ?? error)
      rejectOnce(error)
    }
  })
}
