// connectors/nav/aMeldingAdapter.js (ESM)
export function buildAMeldingDraft({ companyOrgNo, runId, periodStart, periodEnd, lines = [], totals = {} }) {
  return {
    meta: { companyOrgNo, runId, periodStart, periodEnd, generatedAt: new Date().toISOString() },
    totals,
    lines
  };
}
