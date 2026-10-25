const SUCCESS_STATUSES = new Set(['complete', 'partial'])

export function historySyncResponse(merged) {
  return {
    status: merged.importStatus,
    totalNum: merged.totalNum,
    stats: merged.stats,
    problems: merged.problems,
    selection: merged.selection ?? [],
  }
}

export function historySyncState(response) {
  if (
    !SUCCESS_STATUSES.has(response?.status) ||
    !response?.problems ||
    !Array.isArray(response.selection)
  ) {
    return null
  }
  return {
    problems: response.problems,
    selection: response.selection,
  }
}
