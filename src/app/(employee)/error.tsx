'use client';

import { ErrorState } from '@/components/ui/ErrorState';

function EmployeeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} area="dashboard" />;
}

export { EmployeeError as default };
