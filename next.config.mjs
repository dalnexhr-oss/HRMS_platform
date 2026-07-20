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
  },
};

export default nextConfig;
