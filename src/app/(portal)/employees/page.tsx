import { EmployeesScreen } from '@/components/employees/EmployeesScreen';
import { getEmployees } from '@/lib/queries';

export default async function EmployeesPage() {
  const rows = await getEmployees();
  return <EmployeesScreen rows={rows} />;
}
