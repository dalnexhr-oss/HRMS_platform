import { getEmployeeContext } from '@/lib/employee-self-service';
import { getMyAssets } from '@/lib/queries/assets';
import { getMyItems } from '@/lib/queries/items';
import { MyAssets } from '@/components/employee/MyAssets';
import { MyItems } from '@/components/employee/MyItems';
import { UnlinkedEmployeeNotice } from '@/components/employee/UnlinkedEmployeeNotice';

// Equipment assigned to the employee.
async function EmployeeAssetsPage() {
  const { employeeId } = await getEmployeeContext();
  const [assets, items] = await Promise.all([
    employeeId ? getMyAssets(employeeId) : [],
    employeeId ? getMyItems(employeeId) : [],
  ]);

  return (
    <div className="content-container grid">
      <UnlinkedEmployeeNotice employeeId={employeeId} />
      <MyAssets assets={assets} id="assets" />
      <MyItems items={items} id="items" />
    </div>
  );
}

export { EmployeeAssetsPage as default };
