import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'WebLab — Duo',
  description:
    'An interactive folding glass shader. Explore the Duo fold with your own images.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
