/**
 * AetherDrive Engine (policy-first) — optimized + fast paths
 * - Deterministic calculations (no I/O)
 * - Policy injected by caller
 * - detailLevel: "FULL" | "TOTALS" (policy.metrics.detailLevel)
 */

function parseStartDateFast(s) {
  // Expect "YYYY-MM-DD" (10 chars). Avoid split/map allocations.
  if (typeof s !== "string" || s.length < 10) return { startYear: 0, startMonth: 0, startDay: 0 };

  const y =
    (s.charCodeAt(0) - 48) * 1000 +
    (s.charCodeAt(1) - 48) * 100 +
    (s.charCodeAt(2) - 48) * 10 +
    (s.charCodeAt(3) - 48);
  const m = (s.charCodeAt(5) - 48) * 10 + (s.charCodeAt(6) - 48);
  const d = (s.charCodeAt(8) - 48) * 10 + (s.charCodeAt(9) - 48);

  return { startYear: y | 0, startMonth: m | 0, startDay: d | 0 };
}

function ensureParsedJobDatesInPlace(employees) {
  // Mutates job objects by adding startYear/startMonth/startDay if missing.
  for (let i = 0; i < employees.length; i += 1) {
    const e = employees[i];
    const jobs = e && Array.isArray(e.jobs) ? e.jobs : null;
    if (!jobs) continue;

    for (let j = 0; j < jobs.length; j += 1) {
      const job = jobs[j];
      if (!job) continue;

      if (job.startYear && job.startMonth && job.startDay) continue;

      const p = parseStartDateFast(String(job.startDate || ""));
      job.startYear = p.startYear;
      job.startMonth = p.startMonth;
      job.startDay = p.startDay;
    }
  }
}

function getCurrentParts(now, useUTC) {
  if (useUTC) {
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  }
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function yearsSinceParsed(job, currentParts) {
  let years = (currentParts.year - (job.startYear | 0)) | 0;
  const sm = job.startMonth | 0;
  const sd = job.startDay | 0;

  if (currentParts.month < sm || (currentParts.month === sm && currentParts.day < sd)) years -= 1;
  return years > 0 ? years : 0;
}

function roundSalary(x, mode) {
  if (mode === "FLOOR_INT") return Math.floor(x);
  if (mode === "CEIL_INT") return Math.ceil(x);
  return Math.round(x);
}

function buildImportStatus(now, policy) {
  const src = policy?.importStatus?.source ?? "SIMULATED";
  if (src !== "SIMULATED") return null;

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
      salaryRounding: policy?.payroll?.rounding?.salary?.mode ?? "NEAREST_INT",
      detailLevel: policy?.metrics?.detailLevel ?? "FULL"
    },
    inputs: inputSummary
  };
}

export default {
  run: (input = {}, now = new Date(), policy = {}) => {
    const localeCurrency = policy?.locale?.currency ?? "NOK";
    const employees = Array.isArray(input?.employees) ? input.employees : [];

    // Parse start-dates only once per job object (and only if missing)
    ensureParsedJobDatesInPlace(employees);

    const useUTC = policy?.payroll?.raiseAnniversary?.useUTC ?? true;
    const currentParts = getCurrentParts(now, useUTC);

    const raiseModel = policy?.payroll?.raiseModel ?? "COMPOUND_ANNUAL";
    const roundingMode = policy?.payroll?.rounding?.salary?.mode ?? "NEAREST_INT";

    // NEW: fast path control
    const detailLevel = policy?.metrics?.detailLevel ?? "FULL"; // "FULL" | "TOTALS"

    // Build output with minimal allocations
    const employeesOut = new Array(employees.length);
    let totalJobs = 0;

    for (let i = 0; i < employees.length; i += 1) {
      const e = employees[i];
      const jobs = e && Array.isArray(e.jobs) ? e.jobs : [];
      totalJobs += jobs.length;

      let totalSalary = 0;

      if (detailLevel === "TOTALS") {
        // Fast path: compute totals only, no per-job array allocation
        for (let j = 0; j < jobs.length; j += 1) {
          const job = jobs[j];
          const years = yearsSinceParsed(job, currentParts);

          const base = Number(job.baseSalary || 0);
          const inc = Number(job.annualIncrease || 0);

          let newSalary;
          if (raiseModel === "COMPOUND_ANNUAL") newSalary = base * Math.pow(1 + inc, years);
          else newSalary = base * (1 + inc * years);

          totalSalary += roundSalary(newSalary, roundingMode);
        }

        employeesOut[i] = { name: e?.name, jobCount: jobs.length, currentSalary: totalSalary };
        continue;
      }

      // FULL path: include per-job breakdown
      const outJobs = new Array(jobs.length);

      for (let j = 0; j < jobs.length; j += 1) {
        const job = jobs[j];
        const years = yearsSinceParsed(job, currentParts);

        const base = Number(job.baseSalary || 0);
        const inc = Number(job.annualIncrease || 0);

        let newSalary;
        if (raiseModel === "COMPOUND_ANNUAL") newSalary = base * Math.pow(1 + inc, years);
        else newSalary = base * (1 + inc * years);

        const currentSalary = roundSalary(newSalary, roundingMode);
        totalSalary += currentSalary;

        outJobs[j] = { title: job?.title, currentSalary };
      }

      employeesOut[i] = {
        name: e?.name,
        jobCount: jobs.length,
        currentSalary: totalSalary,
        jobs: outJobs
      };
    }

    const revenueCfg = policy?.metrics?.monthlyRevenue;
    const monthlyRevenueNOK = revenueCfg?.source === "FIXED" ? Number(revenueCfg.fixedValue ?? 0) : 182000;

    const importStatus = buildImportStatus(now, policy);

    const explain = buildExplain(now, policy, { employees: employees.length, jobs: totalJobs });

    return {
      status: "Engine running",
      users: employees.length,
      monthlyRevenueNOK,
      currency: localeCurrency,
      employees: employeesOut,
      importStatus,
      explain,
      generatedAt: now.toISOString()
    };
  }
};
