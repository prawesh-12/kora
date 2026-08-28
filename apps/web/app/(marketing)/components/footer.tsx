import { CONTACT } from './nav';
import { Mark, Pill } from './primitives';

/**
 * Every link here goes somewhere that exists: an anchor on this page or a route
 * in the app. Columns the product cannot fill yet are not here at all.
 */
const COLUMNS = [
  {
    heading: 'Product',
    links: [
      ['How it works', '#how-it-works'],
      ['Verification', '#verify'],
      ['Evaluation', '#evaluate'],
      ['Integrations', '#integrations'],
    ],
  },
  {
    heading: 'Console',
    links: [
      ['Operator console', '/ops'],
      ['Approval queue', '/ops/approvals'],
      ['Evaluations', '/ops/evaluations'],
      ['Customer chat', '/chat'],
    ],
  },
  {
    heading: 'Contact',
    links: [['Talk to us', CONTACT]],
  },
] as const;

export function Footer() {
  return (
    <footer className="footer">
      <div className="mk-container footer__grid">
        <div className="footer__brand">
          <Mark size={56} title="KORA" />
          <p className="t-body footer__blurb">
            KORA resolves a customer request, then reads your business system back to confirm it
            actually landed.
          </p>
          <Pill href={CONTACT}>Talk to us</Pill>
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
