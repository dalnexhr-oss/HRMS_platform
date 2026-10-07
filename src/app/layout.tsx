/**
 * The root layout for the application.
 */
import './globals.css';
import { NetworkStatus } from '@/components/shell/NetworkStatus';
import type { Metadata, Viewport } from 'next';

const metadata: Metadata = {
  title: 'Dalnex HRMS — Admin Portal',
  description: 'Attendance & payroll admin portal for Dalnex.',
};

/**
 * The viewport configuration for the application.
 */
const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#FFFFFF',
};

function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400..600&family=Plus+Jakarta+Sans:wght@400..800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <NetworkStatus />
      </body>
    </html>
  );
}

export { metadata, viewport };
export { RootLayout as default };
