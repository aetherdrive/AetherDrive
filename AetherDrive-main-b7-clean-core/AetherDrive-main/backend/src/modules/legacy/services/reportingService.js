// services/reportingService.js (ESM)
export function buildExecutiveSummary({ runId, companyId, periodStart, periodEnd, totals = {}, deviationsCount = 0 }) {
  return {
    run_id: runId,
    company_id: companyId,
    period: { start: periodStart, end: periodEnd },
    totals,
    deviations_count: deviationsCount,
    generated_at: new Date().toISOString()
  };
}
