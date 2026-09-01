import type { Metadata } from 'next';
import './globals.css';

const themeBootstrapScript = `
  (() => {
    const storageKey = 'thor-track.theme.v1';
    let theme = 'light';
    let prefersDark = false;

    try {
      prefersDark = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {}

    try {
      const storedTheme = window.localStorage.getItem(storageKey);
      theme = storedTheme === 'light' || storedTheme === 'dark'
        ? storedTheme
        : prefersDark ? 'dark' : 'light';
    } catch {
      theme = prefersDark ? 'dark' : 'light';
    }

    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  })();
`;

export const metadata: Metadata = {
  title: 'Thor Track — AYN Shipment Watch',
  description: 'Track AYN Thor order-number ranges and follow the latest shipment timeline.',
  openGraph: {
    type: 'website',
    title: 'Thor Track — AYN Shipment Watch',
    description: 'Track AYN Thor order-number ranges and follow the latest shipment timeline.',
    images: [{ url: '/og.png', width: 1732, height: 908, alt: 'Thor Track — AYN shipment watch' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Thor Track — AYN Shipment Watch',
    description: 'Track AYN Thor order-number ranges and follow the latest shipment timeline.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
