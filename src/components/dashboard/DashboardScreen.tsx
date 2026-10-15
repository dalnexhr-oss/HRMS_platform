import { Dashboard } from './MainBoard';
import { LiveRefresh } from './LiveRefresh';
import { CompOffAdminCard } from './CompOffAdminCard';
import type { ComponentProps } from 'react';
import type { Loaded } from './MainBoard';
import type { CompOffAdminRow } from '@/lib/queries/compensatory-off';

function DashboardScreen({
  boardProps,
  compOffs,
}: {
  boardProps: ComponentProps<typeof Dashboard>;
  compOffs: Loaded<CompOffAdminRow[]>;
}) {
  return (
    <>
      {/* Refresh the operational board after new punches arrive. */}
      <LiveRefresh />
      <Dashboard {...boardProps} />
      <div className="content-container grid dashboard-comp-offs">
        <CompOffAdminCard
          rows={compOffs.ok ? compOffs.data : []}
          error={compOffs.ok ? undefined : compOffs.error}
        />
      </div>
    </>
  );
}

export { DashboardScreen };
