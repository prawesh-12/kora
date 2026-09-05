import { Geist, Geist_Mono } from 'next/font/google';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

const sans = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
  preload: true,
});

const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
  // Mono appears only below the fold, so preloading it would compete with the
  // display face for largest contentful paint.
  preload: false,
});

// TODO(plan): brand identity is a designer task. The wordmark, favicon and OG
// image below are Geist plus the signal accent only, no bespoke mark.
export const metadata: Metadata = {
  title: 'Kora',
  description: 'Money operations for subscriptions, proven in Stripe.',
  icons: { icon: '/icon.svg' },
  openGraph: {
    type: 'website',
    siteName: 'Kora',
    title: 'Kora — money operations, proven in Stripe',
    description: 'Refunds, cancellations and plan changes, read back and confirmed.',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
