export default {
  run: (now = new Date(), policy = {}) => {
    const tzMode = policy?.payroll?.raiseAnniversary?.useUTC ?? true;

    function yearsSincePolicy(job, now) {
      const currentYear = tzMode ? now.getUTCFullYear() : now.getFullYear();
      const currentMonth = (tzMode ? now.getUTCMonth() : now.getMonth()) + 1;
      const currentDay = tzMode ? now.getUTCDate() : now.getDate();

      let years = currentYear - job.startYear;
      if (currentMonth < job.startMonth || (currentMonth === job.startMonth && currentDay < job.startDay)) {
        years -= 1;
      }
      return Math.max(0, years);
    }

    function calculateSalaryPolicy(job, now) {
      const years = yearsSincePolicy(job, now);
      const newSalary = job.baseSalary * Math.pow(1 + job.annualIncrease, years);
      return Math.round(newSalary);
    }

    const salaries = employees.map((employee) => {
      const jobs = employee.jobs.map((job) => ({
        title: job.title,
        currentSalary: calculateSalaryPolicy(job, now)
      }));
      const totalSalary = jobs.reduce((sum, job) => sum + job.currentSalary, 0);
      return { name: employee.name, jobCount: jobs.length, currentSalary: totalSalary, jobs };
    });

    const monthlyRevenueNOK =
      policy?.metrics?.monthlyRevenue?.source === "FIXED"
        ? policy.metrics.monthlyRevenue.fixedValue
        : 0;

    const importCfg = policy?.importStatus?.simulated ?? { minutesAgo: 15, accepted: 0, duplicates: 0, rejected: 0 };
    const importStatus = {
      lastImportAt: new Date(now.getTime() - (importCfg.minutesAgo ?? 15) * 60 * 1000).toISOString(),
      accepted: importCfg.accepted ?? 0,
      duplicates: importCfg.duplicates ?? 0,
      rejected: importCfg.rejected ?? 0
    };

    return {
      status: "Engine running",
      users: employees.length,
      monthlyRevenueNOK,
      employees: salaries,
      importStatus,
      policyUsed: {
        version: policy?.version ?? "none",
        timezone: policy?.locale?.timezone ?? "UTC",
        currency: policy?.locale?.currency ?? "NOK",
        anniversaryUTC: tzMode
      },
	 policyUsed: {
  		version: policy?.version ?? "none",
  		timezone: policy?.locale?.timezone ?? "UTC",
  		currency: policy?.locale?.currency ?? "NOK"
	},

      generatedAt: now.toISOString()
    };
  }
};