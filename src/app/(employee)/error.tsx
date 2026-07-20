'use client';

import { ErrorState } from '@/components/ui/ErrorState';

export default function EmployeeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} area="dashboard" />;
}
