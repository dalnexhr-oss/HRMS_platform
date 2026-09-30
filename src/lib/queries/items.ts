import 'server-only';
import { createClient } from '@/lib/db/server-client';
import { fail } from '@/lib/queries/shared';

// items
/** One inventory item with derived quantities from v_items. */
interface ItemRow {
  id: string;
  item_code: string | null;
  item_name: string;
  category: string | null;
  brand: string | null;
  size_spec: string | null;
  total_quantity: number;
  unit: string | null;
  returnable: boolean;
  status: string;
  remarks: string | null;
  quantity_assigned: number;
  quantity_remaining: number;
}

async function getItems(): Promise<ItemRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('v_items')
    .select(
      `id, item_code, item_name, category, brand, size_spec, total_quantity, unit,
       returnable, status, remarks, quantity_assigned, quantity_remaining`,
    )
    .order('item_name');
  if (error) {
    fail('getItems: could not load items', error);
  }
  return (data ?? []) as unknown as ItemRow[];
}

/** One assignment (issuance) of an item to an employee. */
interface ItemAssignmentRow {
  id: string;
  item_id: string;
  person_name: string | null;
  employee_code: string | null;
  quantity: number;
  assigned_date: string;
  assigned_by: string | null;
  returned: boolean;
  returned_date: string | null;
  remarks: string | null;
}

async function getItemAssignments(itemId: string): Promise<ItemAssignmentRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('item_assignments')
    .select(
      `id, item_id, person_name, employee_code, quantity, assigned_date, assigned_by,
       returned, returned_date, remarks`,
    )
    .eq('item_id', itemId)
    .order('assigned_date', { ascending: false });
  if (error) {
    fail('getItemAssignments: could not load assignments', error);
  }
  return (data ?? []) as unknown as ItemAssignmentRow[];
}

/** An item issued to the signed-in employee. */
interface MyItemRow {
  id: string;
  itemName: string;
  category: string | null;
  unit: string | null;
  quantity: number;
  assignedDate: string;
  returned: boolean;
  returnedDate: string | null;
}

async function getMyItems(employeeId: string): Promise<MyItemRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('item_assignments')
    .select(
      'id, quantity, assigned_date, returned, returned_date, items(item_name, category, unit)',
    )
    .eq('employee_id', employeeId)
    .order('assigned_date', { ascending: false });
  if (error) {
    fail('getMyItems: could not load assigned items', error);
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    itemName: r.items?.item_name ?? 'Item',
    category: r.items?.category ?? null,
    unit: r.items?.unit ?? null,
    quantity: r.quantity,
    assignedDate: String(r.assigned_date).slice(0, 10),
    returned: !!r.returned,
    returnedDate: r.returned_date ? String(r.returned_date).slice(0, 10) : null,
  }));
}

export { getItems, getItemAssignments, getMyItems };

export type { ItemRow, ItemAssignmentRow, MyItemRow };
