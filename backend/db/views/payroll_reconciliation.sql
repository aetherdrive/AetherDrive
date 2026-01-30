CREATE OR REPLACE VIEW v_payroll_reconciliation AS
SELECT
  pr.id AS payroll_run_id,
  pr.company_id,
  pr.period_start,
  pr.period_end,
  pr.pay_date,
  pr.status,
  COALESCE(SUM(CASE WHEN pll.line_type='gross' THEN pll.amount END),0) AS gross_total,
  COALESCE(SUM(CASE WHEN pll.line_type='withholding' THEN pll.amount END),0) AS withholding_total,
  COALESCE(SUM(CASE WHEN pi.payment_type='salary' THEN pi.amount END),0) AS salary_payments_total,
  COALESCE(SUM(CASE WHEN pi.payment_type='withholding' THEN pi.amount END),0) AS withholding_payments_total
FROM payroll_runs pr
LEFT JOIN payroll_ledger_lines pll ON pll.payroll_run_id = pr.id
LEFT JOIN payment_instructions pi ON pi.payroll_run_id = pr.id
GROUP BY pr.id;