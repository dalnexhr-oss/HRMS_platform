import { PolicyAdmin } from './PolicyAdmin';
import type { ComponentProps } from 'react';

function PoliciesScreen({ policies, ackCounts, headcount }: ComponentProps<typeof PolicyAdmin>) {
  return (
    <div className="content-container grid company-policies-page">
      <PolicyAdmin policies={policies} ackCounts={ackCounts} headcount={headcount} />
      <p className="text-muted policy-note">
        Published policies appear on every employee&rsquo;s dashboard, where they can read and
        acknowledge them. The count on each published policy is how many active employees have
        marked it as read.
      </p>
    </div>
  );
}

export { PoliciesScreen };
