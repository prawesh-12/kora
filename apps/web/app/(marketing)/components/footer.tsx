import { CONTACT } from './nav';
import { Mark, Pill } from './primitives';

/**
 * Every link here goes somewhere that exists: an anchor on this page or a route
 * in the app. Columns the product cannot fill yet are not here at all.
 */
const COLUMNS = [
  {
    heading: 'This page',
    links: [
      ['Why Kora', '#different'],
      ['Action to proof', '#action-to-proof'],
    ],
  },
  {
    heading: 'Console',
    links: [
      ['Operator console', '/ops'],
      ['Approval queue', '/ops/approvals'],
      ['Connect Stripe', '/ops/connect'],
      ['Customer chat', '/chat'],
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="footer">
      <div className="mk-container footer__grid">
        <div className="footer__brand">
          <Mark size={56} title="KORA" />
          <p className="t-body footer__blurb">
            Kora handles refunds, cancellations and plan changes, then reads Stripe back to confirm
            each one landed.
          </p>
          <Pill href={CONTACT}>Connect Stripe</Pill>
        </div>
        <div className="footer__columns">
          {COLUMNS.map((col) => (
            <nav className="footer__col" key={col.heading} aria-label={col.heading}>
              <h2 className="t-meta footer__heading">{col.heading}</h2>
              <ul>
                {col.links.map(([label, href]) => (
                  <li key={href}>
                    <a className="t-meta footer__link" href={href}>
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
    </footer>
  );
}
