import 'server-only';
import { createClient } from '@/lib/db/server-client';
import { fail } from '@/lib/queries/shared';

// professional tax slabs
interface PtSlabView {
  id: string;
  state: string;
  /** Null applies to every gender. */
  gender: string | null;
  minGross: number;
  /** Null means no upper limit. */
  maxGross: number | null;
  amount: number;
  /** 1–12 for a slab that applies in one month only; null applies every month. */
  month: number | null;
}

/** Every slab, grouped by state and ordered by the gross it starts at. */
async function getPtSlabs(): Promise<PtSlabView[]> {
  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('pt_slabs')
    .select('id, state, gender, min_gross, max_gross, amount, month');
  if (error) {
    fail('getPtSlabs: could not load professional tax slabs', error);
  }
  return (data ?? [])
    .map((slab: any) => ({
      id: slab.id,
      state: slab.state,
      gender: slab.gender ?? null,
      minGross: Number(slab.min_gross),
      maxGross:
        slab.max_gross === null || slab.max_gross === undefined ? null : Number(slab.max_gross),
      amount: Number(slab.amount),
      month: slab.month ?? null,
    }))
    .sort(
      (a: PtSlabView, b: PtSlabView) =>
        a.state.localeCompare(b.state) ||
        a.minGross - b.minGross ||
        (a.month ?? 0) - (b.month ?? 0),
    );
}

export { getPtSlabs };

export type { PtSlabView };
