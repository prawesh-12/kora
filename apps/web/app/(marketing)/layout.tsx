import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './marketing.css';

// Geist and Geist Mono are loaded once in the root layout as --font-geist and
// --font-geist-mono. This route reads those variables rather than loading a
// second copy. The hero serif is a local stack in marketing.css.

export const SITE_URL = process.env.KORA_APP_URL ?? 'http://localhost:3000';

const TITLE = 'Kora — refunds and cancellations, proven in Stripe';

const DESCRIPTION =
  'Kora performs refunds, cancellations and plan changes on Stripe, then reads each one back from Stripe before it tells anyone the money moved.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Kora',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <div className="marketing">{children}</div>;
}
