import { ArrowUpRightGlyph } from './glyphs';
import { Pill, Wordmark } from './primitives';

/**
 * Top tier points at the app, second tier at sections on this page. Nothing
 * appears in both, and there is no link here that does not resolve.
 */
const PRODUCT = [
  { label: 'Operator console', href: '/ops' },
  { label: 'Approvals', href: '/ops/approvals' },
  { label: 'Customer chat', href: '/chat' },
];

const SECTIONS = [
  { label: 'Why Kora', href: '#different' },
  { label: 'Action to proof', href: '#action-to-proof' },
];

export const CONTACT = '/ops/connect';

export function Nav() {
  return (
    <header className="nav">
      <nav className="nav__tier1" aria-label="Main">
        <div className="mk-container nav__row">
          <a className="nav__brand" href="/">
            <Wordmark />
          </a>
          <ul className="nav__product">
            {PRODUCT.map((item) => (
              <li key={item.href}>
                <a className="t-nav nav__link" href={item.href}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          <ul className="nav__utility">
            <li>
              <Pill href={CONTACT}>Connect Stripe</Pill>
            </li>
          </ul>
        </div>
      </nav>

      <div className="nav__tier2">
        <nav className="mk-container nav__row nav__row--tier2" aria-label="Sections">
          <ul className="nav__sections">
            {SECTIONS.map((item) => (
              <li key={item.href}>
                <a className="t-nav nav__link" href={item.href}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          <a className="t-nav nav__link nav__login" href="/ops">
            Log in
            <ArrowUpRightGlyph />
          </a>
        </nav>
      </div>
    </header>
  );
}
