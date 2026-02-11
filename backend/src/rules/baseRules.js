// rules/baseRules.js (ESM)

export function validatePeriod({ periodStart, periodEnd, payDate }) {
  if (!periodStart || !periodEnd) throw new Error("missing_period");
  if (periodStart > periodEnd) throw new Error("invalid_period_range");
  if (payDate && (payDate < periodEnd)) return { ok: true, warning: "pay_date_before_period_end" };
  return { ok: true };
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function computePaidHours(entry) {
  const [sh, sm] = entry.start.split(":").map(Number);
  const [eh, em] = entry.end.split(":").map(Number);
  const startM = sh * 60 + sm;
  const endM = eh * 60 + em;
  if (endM <= startM) throw new Error("invalid_shift_end_before_start");
  const total = endM - startM;
  const paid = total - Number(entry.break_minutes || 0);
  if (paid < 0) throw new Error("invalid_break_minutes");
  return round2(paid / 60);
}

export function computeLines({ entries, payRatesByEmployee = {} }) {
  const lines = [];
  const warnings = [];
  const totals = { gross: 0, hours: 0 };

  for (const e of entries) {
    const hours = computePaidHours(e);
    const rate = Number(payRatesByEmployee[e.employee_id] || 0);
    if (!rate) warnings.push({ code: "missing_rate", employee_id: e.employee_id });

    const amount = round2(hours * rate);
    totals.gross = round2(totals.gross + amount);
    totals.hours = round2(totals.hours + hours);

    lines.push({
      employee_id: e.employee_id,
      date: e.date,
      line_type: "time",
      hours,
      rate,
      amount,
      meta: { source: e.source || "unknown" }
    });
  }

  return { lines, totals, warnings };
}
