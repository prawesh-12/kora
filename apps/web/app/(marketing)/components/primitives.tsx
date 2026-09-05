import type { ReactNode } from 'react';

/**
 * The wordmark is the name set in Geist over the signal rule, matching the
 * favicon. There is no drawn mark.
 *
 * TODO(plan): brand identity is a designer task.
 */
export function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <a className="wordmark" href={href}>
      Kora
    </a>
  );
}

export function ActionLink({
  href,
  tone = 'primary',
  children,
}: {
  href: string;
  tone?: 'primary' | 'quiet' | 'onink';
  children: ReactNode;
}) {
  const modifier = tone === 'primary' ? '' : ` action--${tone}`;
  return (
    <a className={`action${modifier}`} href={href}>
      {children}
    </a>
  );
}
