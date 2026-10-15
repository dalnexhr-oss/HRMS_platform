import 'server-only';
import { createClient } from '@/lib/db/server-client';
import { reserveWrite } from '@/lib/db/write-reservations';

/** Single and bulk CO corrections consume the same FIFO credit, once per employee/date. */
async function consumeManualCompOff(employeeId: string, workDate: string): Promise<void> {
  await reserveWrite(`comp-off:${employeeId}`);
  const client = await createClient();
  const existing = await client
    .from('comp_offs')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('used_date', workDate)
    .in('status', ['applied', 'used'])
    .limit(1);
  if (existing.error) {
    throw new Error(existing.error.message);
  }
  if (existing.data?.length) {
    return;
  }
  const credit = await client
    .from('comp_offs')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('status', 'available')
    .eq('is_applicable', true)
    .order('expires_on', { ascending: true, nullsFirst: false })
    .order('earned_date')
    .limit(1)
    .maybeSingle();
  if (credit.error || !credit.data) {
    throw new Error(
      credit.error?.message ??
        'There is no available comp-off credit for this correction. Nothing was changed.',
    );
  }
  const spent = await client
    .from('comp_offs')
    .update({ status: 'used', used_date: workDate })
    .eq('id', credit.data.id)
    .eq('status', 'available')
    .select('id');
  if (spent.error || spent.data?.length !== 1) {
    throw new Error(spent.error?.message ?? 'The comp-off credit changed. Nothing was changed.');
  }
}

export { consumeManualCompOff };
