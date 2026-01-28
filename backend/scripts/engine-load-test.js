import engine from '../src/engine.js';

const EMPLOYEE_COUNT = 100;
const JOBS_PER_EMPLOYEE = 2;

function buildEmployees() {
  const employees = [];
  for (let i = 0; i < EMPLOYEE_COUNT; i += 1) {
    const jobs = [];
    for (let j = 0; j < JOBS_PER_EMPLOYEE; j += 1) {
      jobs.push({
        title: `Job-${j + 1}`,
        baseSalary: 350000 + j * 25000,
        annualIncrease: 0.02 + j * 0.005,
        startDate: `2020-01-${String((j + 1) * 2).padStart(2, '0')}`
      });
    }
    employees.push({ name: `Employee-${i + 1}`, jobs });
  }
  return employees;
}

function yearsSince(startDate, now) {
  const [year, month, day] = startDate.split('-').map(Number);
  const currentYear = now.getUTCFullYear();
  let years = currentYear - year;
  const currentMonth = now.getUTCMonth() + 1;
  const currentDay = now.getUTCDate();
  if (currentMonth < month || (currentMonth === month && currentDay < day)) {
    years -= 1;
  }
  return Math.max(0, years);
}

function calculateJobSalary(job, now) {
  const years = yearsSince(job.startDate, now);
  const newSalary = job.baseSalary * Math.pow(1 + job.annualIncrease, years);
  return Math.round(newSalary);
}

const now = new Date();
const engineMetrics = engine.run(now);
const dataset = buildEmployees();
const aggregated = dataset.map((employee) => {
  const totalSalary = employee.jobs.reduce(
    (sum, job) => sum + calculateJobSalary(job, now),
    0
  );
  return {
    name: employee.name,
    jobCount: employee.jobs.length,
    currentSalary: totalSalary
  };
});

const result = {
  engineUsers: engineMetrics.users,
  syntheticUsers: aggregated.length,
  sample: aggregated.slice(0, 5)
};

console.log(JSON.stringify(result, null, 2));
