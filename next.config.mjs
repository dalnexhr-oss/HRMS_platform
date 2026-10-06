import nextConstants from 'next/constants.js';

/** @param {string} phase @returns {import('next').NextConfig} */
const nextConfig = (phase) => ({
  // Keep development output separate so it cannot overwrite a production build.
  distDir:
    process.env.NEXT_DIST_DIR ||
    (phase === nextConstants.PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next'),
  reactStrictMode: true,
  typedRoutes: true,
  allowedDevOrigins: ['172.20.16.1', 'http://192.168.0.214:3000'],
  // exceljs pulls in unzipper, whose optional S3 helper requires an AWS SDK we don't install.
  // Loading it from node_modules at runtime keeps webpack from trying to resolve that.
  serverExternalPackages: ['exceljs'],
  experimental: {
    serverActions: {
      bodySizeLimit: '12mb',
    },
  },
});

export { nextConfig as default };
