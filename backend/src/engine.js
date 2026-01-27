// Dummy motor med årlig lønnsøkning
function calculateSalary(employee) {
  const today = new Date();
  const start = new Date(employee.startDate);
  const years = Math.floor((today - start) / (365*24*60*60*1000));
  const newSalary = employee.baseSalary * Math.pow(1 + employee.annualIncrease, years);
  return Math.round(newSalary);
}

const employees = [
  { name: "Marcus", baseSalary: 500000, annualIncrease: 0.03, startDate: "2021-01-01" },
  { name: "Anna", baseSalary: 450000, annualIncrease: 0.02, startDate: "2022-06-01" }
];

export default {
  run: () => {
    const salaries = employees.map(e => ({
      name: e.name,
      currentSalary: calculateSalary(e)
    }));
    return {
      status: "Engine running",
      users: employees.length,
      monthlyRevenueNOK: 182000,
      employees: salaries
    };
  }
};
