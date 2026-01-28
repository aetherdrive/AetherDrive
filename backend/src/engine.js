/**
 * AetherDrive Engine (policy-first)
 * - Deterministic calculations (no I/O)
 * - Policy injected by caller
 * - Input can be provided (employees/jobs/events), with demo fallback
 */

function parseStartDate(startDate) {
  const [year, month, day] = String(startDate).split("-").map(Number);
  return { startYear: year, startMonth: month, startDay: day };
}

function withParsedJobDates(employees) {
  return employees.map((employee) => ({
    ...employee,
    jobs: (employee.jobs || []).map((job) => ({
      ...job,
      ...parseStartDate(job.startDate)
    }))
  }));
}

function getDateParts(now, useUTC) {
  return {
    year: useUTC ? now.getUTCFullYear() : now.getFullYear(),
    month: (useUTC ? now.getUTCMonth() : now.getMonth()) + 1,
    day: useUTC ? now.getUTCDate() : now.getDate()
  };
}

function yearsSince({ startYear, startMonth, startDay }, now, useUTC) {
  const current = getDateParts(now, useUTC);

  let years = current.year - startYear;
  if (current.month < startMonth || (current.month === startMonth && current.day < startDay)) {
    years -= 1;
  }
  return Math.max(0, years);
}

function calculateSalary(job, now, policy) {
  const useUTC = policy?.payroll?.raiseAnniversary?.useUTC ?? true;
  const years = yearsSince(job, now, useUTC);

  const raiseModel = policy?.payroll?.raiseModel ?? "COMPOUND_ANNUAL";
  let newSalary;

  if (raiseModel === "COMPOUND_ANNUAL") {
    newSalary = job.baseSalary * Math.pow(1 + job.annualIncrease, years);
  } else {
    // fallback: simple (non-compounded) annual raise
    newSalary = job.baseSalary * (1 + job.annualIncrease * years);
  }

  const roundingMode = policy?.payroll?.rounding?.salary?.mode ?? "NEAREST_INT";
  if (roundingMode === "NEAREST_INT") return Math.round(newSalary);
  if (roundingMode === "FLOOR_INT") return Math.floor(newSalary);
  if (roundingMode === "CEIL_INT") return Math.ceil(newSalary);

  return Math.round(newSalary);
}

function buildImportStatus(now, policy) {
  const src = policy?.importStatus?.source ?? "SIMULATED";
  if (src !== "SIMULATED") {
    // Placeholder: later you can plug real import status from DB/connector
    return null;
  }

  const sim = policy?.importStatus?.simulated ?? {};
  const minutesAgo = sim.minutesAgo ?? 15;
  const lastImport = new Date(now.getTime() - minutesAgo * 60 * 1000);

  return {
    lastImportAt: lastImport.toISOString(),
    accepted: sim.accepted ?? 128,
    duplicates: sim.duplicates ?? 4,
    rejected: sim.rejected ?? 2
  };
}

function buildExplain(now, policy, inputSummary) {
  return {
    generatedAt: now.toISOString(),
    policyUsed: {
      version: policy?.version ?? "none",
      timezone: policy?.locale?.timezone ?? "UTC",
      currency: policy?.locale?.currency ?? "NOK",
      raiseModel: policy?.payroll?.raiseModel ?? "COMPOUND_ANNUAL",
      anniversaryUTC: policy?.payroll?.raiseAnniversary?.useUTC ?? true,
      salaryRounding: policy?.payroll?.rounding?.salary?.mode ?? "NEAREST_INT"
    },
    inputs: inputSummary
  };
}

// Demo fallback (keeps your current behavior working)
const DEMO_EMPLOYEES = withParsedJobDates([
  {
    name: "Marcus",
    jobs: [
      { title: "Backend", baseSalary: 380000, annualIncrease: 0.03, startDate: "2021-01-01" },
      { title: "Ops", baseSalary: 140000, annualIncrease: 0.025, startDate: "2022-05-01" }
    ]
  },
  {
    name: "Anna",
    jobs: [
      { title: "Frontend", baseSalary: 450000, annualIncrease: 0.02, startDate: "2022-06-01" }
    ]
  }
]);

export default {
  /**
   * run(input, now, policy)
   * - input: { employees, jobs, events }
   * - now: Date (injiserbar for testing)
   * - policy: policy.json (regler)
   */
  run: (input = {}, now = new Date(), policy = {}) => {
    // engine-logikk
  }
};

    const currency = policy?.locale?.currency ?? "NOK";

    const employeesInput = input?.employees?.length ? input.employees : DEMO_EMPLOYEES;
    const employees = withParsedJobDates(employeesInput);

    const salaries = employees.map((employee) => {
      const jobs = (employee.jobs || []).map((job) => ({
        title: job.title,
        currentSalary: calculateSalary(job, now, policy)
      }));
      const totalSalary = jobs.reduce((sum, j) => sum + j.currentSalary, 0);

      return {
        name: employee.name,
        jobCount: jobs.length,
        currentSalary: totalSalary,
        jobs
      };
    });

    // Revenue: policy can override fixed value; fallback keeps current behavior
    const revenueCfg = policy?.metrics?.monthlyRevenue;
    const monthlyRevenueNOK =
      revenueCfg?.source === "FIXED"
        ? Number(revenueCfg.fixedValue ?? 0)
        : 182000;

    const importStatus = buildImportStatus(now, policy);

    const explain = buildExplain(now, policy, {
      employees: employees.length,
      jobs: employees.reduce((acc, e) => acc + (e.jobs?.length ?? 0), 0)
    });

    return {
      status: "Engine running",
      users: employees.length,
      monthlyRevenueNOK,
      currency,
      employees: salaries,
      importStatus,
      explain
    };
  }
};
