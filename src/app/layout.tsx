import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dalnex HRMS — Admin Portal',
  description: 'Attendance & payroll admin portal for Dalnex.',
};

/**
 * Without this the page has no viewport meta at all, so every mobile browser
 * assumes a ~980px desktop canvas and zooms the whole app out — which is why
 * nothing here was readable on a phone regardless of the CSS.
 *
 * maximumScale is deliberately NOT set: pinch-zoom is an accessibility right,
 * and the iOS zoom-on-focus problem it is usually used to paper over is fixed
 * properly in globals.css by keeping mobile inputs at 16px.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#FFFFFF',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
      <body>{children}</body>
    </html>
  );
}
