/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  allowedDevOrigins: ['172.20.16.1'],
  experimental: {
    serverActions: {
      // The monthly register is uploaded through a Server Action; the default
      // 1MB body limit would reject it (the June 2026 sample is already 177KB
      // with only 4 employees — a full roster is far larger).
      bodySizeLimit: '10mb',
    },
    // DO NOT set experimental.staleTimes here.
    //
    // It was tried (dynamic: 30) to make revisiting a nav item instant, on the
    // reasoning that revalidatePath is called on every write so a user could
    // never see their own change masked. That reasoning did not hold: with a
    // non-zero dynamic staleTime the client Router Cache kept serving the old
    // segment after a mutation, so acknowledging a policy and ticking an
    // onboarding step both left visibly stale UI.
    //
    // A page that is fast but shows last minute's data is worse than a page
    // that is slow and correct. Navigation speed is bought instead by the
    // things that don't trade away freshness: React.cache() on getSession,
    // the middleware prefetch bail, and prefetch={false} on the sidebar.
  },
};

export default nextConfig;
