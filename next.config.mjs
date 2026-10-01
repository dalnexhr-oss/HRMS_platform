/** @type {import('next').NextConfig} */
const nextConfig = {
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
};

export { nextConfig as default };
