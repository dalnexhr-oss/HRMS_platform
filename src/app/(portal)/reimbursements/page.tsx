import { ReimbursementsScreen } from '@/components/reimbursements/ReimbursementsScreen';
import { getReimbursements, isSupabaseConfigured } from '@/lib/queries';

export default async function ReimbursementsPage() {
  const claims = await getReimbursements();

  return (
    <>
      {!isSupabaseConfigured() && (
        <div className="wrap">
          <div
            className="card"
            style={{ borderColor: '#e6c877', background: '#fdf6e3', marginBottom: 14 }}
          >
            <div className="bd">
              <p className="muted" style={{ margin: 0 }}>
                Demo mode — reimbursement claims are stored in the database, so none are shown and
                nothing can be approved until Supabase is connected.
              </p>
            </div>
          </div>
        </div>
      )}
      <ReimbursementsScreen claims={claims} />
    </>
  );
}
