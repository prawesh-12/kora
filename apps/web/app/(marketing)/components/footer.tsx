import { CONNECT } from './nav';
import { ActionLink, Wordmark } from './primitives';

/** Every link goes to an anchor on this page or a route in the app. */
const COLUMNS = [
  {
    heading: 'This page',
    links: [
      ['How it works', '#how'],
      ['From action to proof', '#proof'],
    ],
  },
  {
    heading: 'Product',
    links: [
      ['Operator console', '/ops'],
      ['Approvals', '/ops/approvals'],
      ['Customer chat', '/chat'],
      ['Connect Stripe', CONNECT],
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="footer">
      <div className="mk-container footer__grid">
        <div>
          <Wordmark />
          <p className="t-body footer__blurb">
            Kora handles refunds, cancellations, plan changes and billing questions on Stripe
            Billing, and reads Stripe back before it tells anyone the money moved.
          </p>
          <p className="t-meta footer__blurb">Stripe test mode. One restricted key per tenant.</p>
          <div style={{ marginTop: 24 }}>
            <ActionLink href={CONNECT} tone="quiet">
              Connect Stripe
            </ActionLink>
          </div>
        </div>
        <div className="footer__cols">
          {COLUMNS.map((col) => (
            <nav aria-label={col.heading} className="footer__col" key={col.heading}>
              <h2 className="footer__heading">{col.heading}</h2>
              <ul>
                {col.links.map(([label, href]) => (
                  <li key={href}>
                    <a className="footer__link" href={href}>
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
