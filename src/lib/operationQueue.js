// Serialize asynchronous operations and keep the queue usable after failure.
export function enqueueOperation(state, operation) {
  const queued = state.current.then(operation)
  state.current = queued.catch(() => {})
  return queued
}
