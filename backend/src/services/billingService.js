/**
 * Billing service (stub)
 * Pricing model:
 *  - base_fee_per_company = 999 NOK / month
 *  - per_employee_fee = 20 NOK / employee / month
 *
 * This stub calculates invoice preview. Integrate with Stripe later.
 */
export function calculateInvoice({ companyId, employeeCount }) {
  const baseFee = Number(process.env.BILLING_BASE_FEE || 999);
  const perEmployee = Number(process.env.BILLING_PER_EMPLOYEE_FEE || 20);
  const subtotal = baseFee + (employeeCount * perEmployee);
  return {
    companyId,
    currency: 'NOK',
    baseFee,
    perEmployee,
    employeeCount,
    subtotal
  };
}
