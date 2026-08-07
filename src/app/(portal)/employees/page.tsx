import { EmployeesScreen } from '@/components/employees/EmployeesScreen';
import { getEmployees, getDepartments, getBranches } from '@/lib/queries';

export default async function EmployeesPage() {
  // Branches come from the table rather than a hardcoded pair, so the dropdown
  // can only ever offer a branch updateEmployee can actually resolve.
  const [rows, departments, branches] = await Promise.all([
    getEmployees(true),
    getDepartments(),
    getBranches(),
  ]);
  return <EmployeesScreen rows={rows} departments={departments} branches={branches} />;
}
