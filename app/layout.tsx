import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
