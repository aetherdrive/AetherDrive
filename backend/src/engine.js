const employees = [
  {
    name: "Marcus",
    baseSalary: 500000,
    annualIncrease: 0.03,
    startDate: "2021-01-01"
  },
  {
    name: "Anna",
    baseSalary: 450000,
    annualIncrease: 0.02,
    startDate: "2022-06-01"
  }
].map((employee) => {
  const [year, month, day] = employee.startDate.split("-").map(Number);
  return {
    ...employee,
    startYear: year,
    startMonth: month,
    startDay: day
  };
});

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

function calculateSalary(employee, now) {
  const years = yearsSince(employee.startYear, employee.startMonth, employee.startDay, now);
  const newSalary = employee.baseSalary * Math.pow(1 + employee.annualIncrease, years);
  return Math.round(newSalary);
}

export default {
  run: (now = new Date()) => {
    const salaries = employees.map((employee) => ({
      name: employee.name,
      currentSalary: calculateSalary(employee, now)
    }));
    return {
      status: "Engine running",
      users: employees.length,
      monthlyRevenueNOK: 182000,
      employees: salaries,
      generatedAt: now.toISOString()
    };
  }
};