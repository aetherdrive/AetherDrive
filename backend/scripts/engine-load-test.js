import engine from "../src/engine.js";

const EMPLOYEE_COUNT = 10000;
const JOBS_PER_EMPLOYEE = 3;

function buildEmployees() {
  const employees = [];
  for (let i = 0; i < EMPLOYEE_COUNT; i += 1) {
    const jobs = [];
    for (let j = 0; j < JOBS_PER_EMPLOYEE; j += 1) {
      jobs.push({
        title: `Job-${j + 1}`,
        baseSalary: 350000 + j * 25000,
        annualIncrease: 0.02 + j * 0.005,
        startDate: `2020-01-${String((j + 1) * 2).padStart(2, "0")}`
      });
    }
    employees.push({ name: `Employee-${i + 1}`, jobs });
  }
  return employees;
}

const now = new Date();

// Optional policy for realism (matches your policy.json shape)
const policy = {
  version: "1.0",
  locale: { timezone: "UTC", currency: "NOK" },
  payroll: { raiseAnniversary: { useUTC: true }, raiseModel: "COMPOUND_ANNUAL", rounding: { salary: { mode: "NEAREST_INT" } } },
  metrics: { monthlyRevenue: { source: "FIXED", fixedValue: 182000 } },
  importStatus: { source: "SIMULATED", simulated: { minutesAgo: 15, accepted: 128, duplicates: 4, rejected: 2 } }
};

const employees = buildEmployees();
const input = { employees };

const t0 = Date.now();
const engineMetrics = engine.run(input, now, policy);
const t1 = Date.now();

console.log(JSON.stringify({
  ms: t1 - t0,
  users: engineMetrics.users,
  sampleEmployees: engineMetrics.employees.slice(0, 5),
  revenue: engineMetrics.monthlyRevenueNOK,
  policyVersion: engineMetrics.explain?.policyUsed?.version
}, null, 2));
