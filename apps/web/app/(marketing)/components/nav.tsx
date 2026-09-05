import { ActionLink, Wordmark } from './primitives';

/** Nothing here that does not resolve: two anchors on this page, two app routes. */
const LINKS = [
  { label: 'How it works', href: '#how' },
  { label: 'From action to proof', href: '#proof' },
  { label: 'Log in', href: '/ops' },
];

export const CONNECT = '/ops/connect';

export function Nav() {
  return (
    <header className="nav">
      <nav aria-label="Main" className="mk-container nav__row">
        <Wordmark />
        <ul className="nav__links">
          {LINKS.map((item) => (
            <li key={item.href}>
              <a className="nav__link" href={item.href}>
                {item.label}
              </a>
            </li>
          ))}
          <li>
            <ActionLink href={CONNECT}>Connect Stripe</ActionLink>
          </li>
        </ul>
      </nav>
    </header>
  );
}
