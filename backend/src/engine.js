const employees = [
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
].map((employee) => ({
  ...employee,
  jobs: employee.jobs.map((job) => {
    const [year, month, day] = job.startDate.split("-").map(Number);
    return {
      ...job,
      startYear: year,
      startMonth: month,
      startDay: day
    };
  })
}));

function yearsSince(startYear, startMonth, startDay, now) {
  const currentYear = now.getUTCFullYear();
  let years = currentYear - startYear;
  const currentMonth = now.getUTCMonth() + 1;
  const currentDay = now.getUTCDate();
  if (currentMonth < startMonth || (currentMonth === startMonth && currentDay < startDay)) {
    years -= 1;
  }
  return Math.max(0, years);
}

function calculateSalary(job, now) {
  const years = yearsSince(job.startYear, job.startMonth, job.startDay, now);
  const newSalary = job.baseSalary * Math.pow(1 + job.annualIncrease, years);
  return Math.round(newSalary);
}

function buildImportStatus(now) {
  const lastImport = new Date(now.getTime() - 15 * 60 * 1000);
  return {
    lastImportAt: lastImport.toISOString(),
    accepted: 128,
    duplicates: 4,
    rejected: 2
  };
}

export default {
  run: (now = new Date()) => {
    const salaries = employees.map((employee) => {
      const jobs = employee.jobs.map((job) => ({
        title: job.title,
        currentSalary: calculateSalary(job, now)
      }));
      const totalSalary = jobs.reduce((sum, job) => sum + job.currentSalary, 0);
      return {
        name: employee.name,
        jobCount: jobs.length,
        currentSalary: totalSalary,
        jobs
      };
    });
    return {
      status: "Engine running",
      users: employees.length,
      monthlyRevenueNOK: 182000,
      employees: salaries,
      importStatus: buildImportStatus(now),
      generatedAt: now.toISOString()
    };
  }
};
