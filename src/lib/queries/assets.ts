import 'server-only';
import { createClient } from '@/lib/db/server-client';
import { fail } from '@/lib/queries/shared';

// assets
/** One row of the IT asset register. Admin/HR only. */
interface AssetRow {
  id: string;
  qr_url: string | null;
  purchase_date: string | null;
  purchase_cost: number | null;
  desktop_name: string;
  asset_category: string | null;
  brand: string | null;
  serial_no: string | null;
  model_no: string | null;
  warranty_upto: string | null;
  warranty_renew: string | null;
  product_id: string | null;
  device_id: string | null;
  processor: string | null;
  ram: string | null;
  graphics_card: string | null;
  storage: string | null;
  antivirus: string | null;
  assigned_employee_id: string | null;
  assigned_person_name: string | null;
  assigned_employee_code: string | null;
  assigned_date: string | null;
}

const assetCols = `id, purchase_date, purchase_cost, desktop_name, asset_category, brand, serial_no, model_no,
   warranty_upto, warranty_renew, product_id, device_id, processor, ram, graphics_card, storage,
   antivirus, qr_url, assigned_employee_id, assigned_person_name, assigned_employee_code, assigned_date`;

async function getAssets(): Promise<AssetRow[]> {
  const queryClient = await createClient();
  const res = await queryClient.from('assets').select(assetCols).order('desktop_name');
  if (res.error) {
    fail('getAssets: could not load assets', res.error);
  }
  // purchase_cost is stored as Decimal128 — money is never a float at rest
  // (lib/db/decimal-conversions.ts). The screen only displays it, so widen to a number here
  // rather than leaking a BSON type into a client component.
  const rows = (res.data ?? []) as unknown as Array<
    Omit<AssetRow, 'purchase_cost'> & {
      purchase_cost: unknown;
    }
  >;
  return rows.map((r) => ({
    ...r,
    qr_url: r.qr_url ?? null,
    purchase_cost: r.purchase_cost == null ? null : Number(String(r.purchase_cost)),
  }));
}

/** Asset stock summary from v_asset_summary. */
interface AssetSummaryRow {
  category: string;
  total: number;
  assigned: number;
  available: number;
  warranty_expiring: number;
}

async function getAssetSummary(): Promise<AssetSummaryRow[]> {
  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('v_asset_summary')
    .select('category, total, assigned, available, warranty_expiring');
  if (error) {
    fail('getAssetSummary: could not load the asset summary', error);
  }
  return (data ?? []).map((r: any) => ({
    category: r.category,
    total: Number(r.total ?? 0),
    assigned: Number(r.assigned ?? 0),
    available: Number(r.available ?? 0),
    warranty_expiring: Number(r.warranty_expiring ?? 0),
  }));
}

/** One asset transfer-history row. */
interface AssetAssignmentRow {
  id: string;
  asset_id: string;
  person_name: string | null;
  employee_code: string | null;
  assigned_date: string;
  assigned_by: string | null;
  returned: boolean;
  returned_date: string | null;
  remarks: string | null;
}

async function getAssetAssignments(assetId: string): Promise<AssetAssignmentRow[]> {
  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('asset_assignments')
    .select(
      'id, asset_id, person_name, employee_code, assigned_date, assigned_by, returned, returned_date, remarks',
    )
    .eq('asset_id', assetId)
    .order('assigned_date', { ascending: false });
  if (error) {
    fail('getAssetAssignments: could not load history', error);
  }
  return (data ?? []) as unknown as AssetAssignmentRow[];
}

/** One asset maintenance row. */
interface AssetMaintenanceRow {
  id: string;
  asset_id: string;
  maint_date: string;
  maint_type: string | null;
  cost: number | null;
  vendor: string | null;
  notes: string | null;
  next_due: string | null;
  created_by: string | null;
}

async function getAssetMaintenance(assetId: string): Promise<AssetMaintenanceRow[]> {
  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('asset_maintenance')
    .select('id, asset_id, maint_date, maint_type, cost, vendor, notes, next_due, created_by')
    .eq('asset_id', assetId)
    .order('maint_date', { ascending: false });
  if (error) {
    fail('getAssetMaintenance: could not load maintenance', error);
  }
  return (data ?? []).map((r: any) => ({
    ...r,
    cost: r.cost == null ? null : Number(r.cost),
  })) as AssetMaintenanceRow[];
}

// employee assets / items
/** An asset currently assigned to the signed-in employee. */
interface MyAssetRow {
  id: string;
  desktop_name: string;
  brand: string | null;
  serial_no: string | null;
  model_no: string | null;
  assigned_date: string | null;
}

async function getMyAssets(employeeId: string): Promise<MyAssetRow[]> {
  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('assets')
    .select('id, desktop_name, brand, serial_no, model_no, assigned_date')
    .eq('assigned_employee_id', employeeId)
    .order('desktop_name');
  if (error) {
    // Return an empty list when maintenance history is unavailable.
    fail('getMyAssets: could not load assigned assets', error);
  }
  return (data ?? []) as unknown as MyAssetRow[];
}

export { getAssets, getAssetSummary, getAssetAssignments, getAssetMaintenance, getMyAssets };

export type { AssetRow, AssetSummaryRow, AssetAssignmentRow, AssetMaintenanceRow, MyAssetRow };
