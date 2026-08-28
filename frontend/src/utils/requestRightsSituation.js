function zeroMetrics() {
  return { takenDays: 0, pendingDays: 0, validatedDays: 0 }
}

function metricsFromSummary(summary) {
  if (!summary) return zeroMetrics()
  return {
    takenDays: Number(summary.takenDays ?? 0),
    pendingDays: Number(summary.pendingDays ?? 0),
    validatedDays: Number(summary.validatedDays ?? 0),
  }
}

export function buildRequestRightsSituation({
  periodSummaries = [],
  projection = null,
  selectedReferencePeriod = null,
} = {}) {
  const summaries = new Map(
    (periodSummaries ?? [])
      .filter((item) => item?.referencePeriod)
      .map((item) => [item.referencePeriod, item]),
  )

  const periods = []
  const addPeriod = (referencePeriod, requestedDays = 0) => {
    if (!referencePeriod || periods.some((item) => item.referencePeriod === referencePeriod)) return
    periods.push({
      referencePeriod,
      requestedDays: Number(requestedDays ?? 0),
      metrics: metricsFromSummary(summaries.get(referencePeriod)),
    })
  }

  if (projection) {
    if (Number(projection.nMinus1Used ?? 0) > 0) {
      addPeriod(projection.nMinus1Period, projection.nMinus1Used)
    }
    if (Number(projection.nUsed ?? 0) > 0) {
      addPeriod(projection.nPeriod, projection.nUsed)
    }
  }

  if (periods.length === 0) {
    addPeriod(selectedReferencePeriod, 0)
  }

  return periods
}
