import { Geist } from 'next/font/google';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './marketing.css';

/**
 * Geist for display, matching the product's Ledger type system. The hero
 * headline sets its own serif stack locally; that exception lives only on the
 * landing page. The mono comes from the root layout, already loaded there.
 */
const display = Geist({
  subsets: ['latin'],
  variable: '--font-inter-tight',
  display: 'swap',
  preload: true,
});

export const SITE_URL = process.env.KORA_APP_URL ?? 'http://localhost:3000';

const DESCRIPTION =
  'KORA resolves customer requests end to end, then reads your business system back to confirm the refund landed. Policy runs in code, not a prompt.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'KORA — support that proves it worked',
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'KORA',
    title: 'KORA — support that proves it worked',
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'KORA — support that proves it worked',
    description: DESCRIPTION,
  },
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <div className={`marketing ${display.variable}`}>{children}</div>;
}
