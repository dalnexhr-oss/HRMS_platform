import { EmployeesScreen } from '@/components/employees/EmployeesScreen';
import { getEmployees, getDepartments } from '@/lib/queries';

export default async function EmployeesPage() {
  const [rows, departments] = await Promise.all([getEmployees(true), getDepartments()]);
  return <EmployeesScreen rows={rows} departments={departments} />;
}
