import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'KORA type specimen',
  robots: { index: false, follow: false },
};

const STEPS = [
  ['--t-hero', 't-hero', '72 / 0.98 · 800 · -0.02em', 'hero headline only'],
  ['--t-section', 't-section', '56 / 1.00 · 800 · -0.02em', 'every section headline'],
  ['--t-pillar', 't-pillar', '34 / 1.15 · 700 · -0.01em', 'Act, Verify, Evaluate, Improve'],
  ['--t-accordion', 't-accordion', '26 / 1.2 · 700 · 0', 'accordion item titles'],
  ['--t-card', 't-card', '22 / 1.35 · 600 · 0', 'problem card body'],
  ['--t-lead', 't-lead', '24 / 1.45 · 400 · 0', 'hero right column'],
  ['--t-body', 't-body', '21 / 1.55 · 400 · 0', 'pillar and section body'],
  ['--t-eyebrow', 't-eyebrow', '18 / 1.4 · 400 · 0', 'section eyebrow labels'],
  ['--t-nav', 't-nav', '16 / 1 · 500 · 0', 'nav links'],
  ['--t-meta', 't-meta', '15 / 1.4 · 400 · 0', 'card meta, footer links'],
] as const;

export default function SpecimenPage() {
  return (
    <main className="mk-container mk-section spec">
      <h1 className="t-section" id="spec-title">
        Type specimen
      </h1>
      <p className="t-body spec__note">
        Ten steps. Resize the window: the five responsive steps change at 1280 and 768, the other
        five hold.
      </p>
      {STEPS.map(([token, cls, meta, use]) => (
        <section className="spec__row" key={token}>
          <p className="t-meta spec__label">
            <span className="spec__token">{token}</span>
            <span>{meta}</span>
            <span className="spec__use">{use}</span>
          </p>
          <p className={`${cls} spec__sample`} data-token={token}>
            Support that proves it worked
          </p>
        </section>
      ))}
    </main>
  );
}
