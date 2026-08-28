import type { ReactNode } from 'react';

/**
 * The KORA mark. An --ink square with a --signal check knocked out of it.
 * Two flat shapes, authored here because the mark does not exist anywhere else.
 */
export function Mark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg
      className="mark"
      width={size}
      height={size}
      viewBox="0 0 72 72"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect width="72" height="72" fill="var(--ink)" />
      <path
        d="M17 37 L30 50 L55 22"
        fill="none"
        stroke="var(--signal)"
        strokeWidth="9"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <Mark size={28} title="KORA" />
      <span className="wordmark__text">KORA</span>
    </span>
  );
}

type PillProps = {
  href: string;
  variant?: 'primary' | 'secondary';
  icon?: ReactNode;
  children: ReactNode;
};

export function Pill({ href, variant = 'primary', icon, children }: PillProps) {
  return (
    <a className={`pill pill--${variant}`} href={href}>
      {icon}
      {children}
    </a>
  );
}

export function IconTile({ fill, children }: { fill: string; children: ReactNode }) {
  return (
    <span className="icon-tile" style={{ background: fill }} aria-hidden="true">
      {children}
    </span>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow t-eyebrow">{children}</p>;
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="section-heading t-section">{children}</h2>;
}

export function Panel({
  tone = 'warm',
  className,
  children,
}: {
  tone?: 'warm' | 'cream';
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={['panel', tone === 'cream' && 'panel--cream', className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}

export function Dots({ style }: { style: React.CSSProperties }) {
  return <div className="dots" style={style} aria-hidden="true" />;
}
