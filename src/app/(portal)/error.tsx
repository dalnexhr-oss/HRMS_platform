'use client';

import { ErrorState } from '@/components/ui/ErrorState';

function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState error={error} reset={reset} area="portal" />;
}

export { PortalError as default };
