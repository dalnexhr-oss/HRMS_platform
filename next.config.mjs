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
    // Next 15 defaults the client Router Cache to 0s for dynamic segments, so
    // re-clicking a nav item re-runs the layout and page from scratch — on a
    // free-tier database in Mumbai that is seconds of dead time for a page the
    // browser rendered moments ago.
    //
    // Safe here BECAUSE this app calls revalidatePath on essentially every
    // write: any mutation invalidates the whole Router Cache, so a user never
    // sees their own change masked. The only staleness window is another user's
    // change within 30s, which is fine for an internal HRMS.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
