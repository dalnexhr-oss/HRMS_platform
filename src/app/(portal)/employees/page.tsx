import { EmployeesScreen } from '@/components/employees/EmployeesScreen';
import { getEmployees, getDepartments, getBranches } from '@/lib/queries';

export default async function EmployeesPage() {
  // Load branch options from the database so updateEmployee can resolve each selection.
  const [rows, departments, branches] = await Promise.all([
    getEmployees(true),
    getDepartments(),
    getBranches(),
  ]);
  return <EmployeesScreen rows={rows} departments={departments} branches={branches} />;
}
