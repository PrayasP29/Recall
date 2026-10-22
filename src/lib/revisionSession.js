const REVISION_QUERY = 'recallRevision'
const REVISION_VALUE = '1'

export function isRevisionSessionUrl(url) {
  try {
    return new URL(url).searchParams.get(REVISION_QUERY) === REVISION_VALUE
  } catch {
    return false
  }
}

export function revisionSessionUrl(url) {
  try {
    const next = new URL(url)
    next.searchParams.set(REVISION_QUERY, REVISION_VALUE)
    return next.toString()
  } catch {
    return null
  }
}
