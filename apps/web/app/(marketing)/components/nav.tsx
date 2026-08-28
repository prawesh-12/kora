import { ArrowUpRightGlyph, CaretGlyph } from './glyphs';
import { Pill, Wordmark } from './primitives';

/**
 * KORA is one product. These name the three surfaces it actually has rather
 * than inventing a product line for each slot.
 */
const PRODUCT = [
  { label: 'Agent', active: true },
  { label: 'Operator console', active: false },
  { label: 'Evaluation', active: false },
];

/**
 * Every second-tier item is an anchor to a section that exists on this page.
 * Security and Pricing are not here because those sections are not.
 */
const SECTIONS = [
  { label: 'Why we made this', href: '#why' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Verification', href: '#verify' },
  { label: 'Evaluation', href: '#evaluate' },
  { label: 'Integrations', href: '#integrations' },
];

export const CONTACT = 'mailto:hello@kora.example?subject=KORA';

export function Nav() {
  return (
    <header className="nav">
      <nav className="nav__tier1" aria-label="Main">
        <div className="mk-container nav__row">
          <a className="nav__brand" href="/">
            <Wordmark />
          </a>
          <ul className="nav__product">
            {PRODUCT.map((item) => {
              const cls = `t-nav nav__link${item.active ? ' nav__link--active' : ''}`;
              const current = item.active ? 'page' : undefined;
              return (
                <li key={item.label}>
                  {/* biome-ignore lint/a11y/useValidAnchor: no destination exists yet */}
                  <a className={cls} href="#" aria-current={current}>
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>
          <ul className="nav__utility">
            <li>
              {/* biome-ignore lint/a11y/useValidAnchor: no destination exists for these yet */}
              <a className="t-nav nav__link" href="#">
                Docs
              </a>
            </li>
            <li>
              {/* biome-ignore lint/a11y/useValidAnchor: no destination exists for these yet */}
              <a className="t-nav nav__link nav__link--caret" href="#">
                Company
                <CaretGlyph />
              </a>
            </li>
            <li>
              <Pill href={CONTACT}>Talk to us</Pill>
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
