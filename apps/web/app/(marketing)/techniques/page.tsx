import type { Metadata } from 'next';
import { Dots, Mark, Pill } from '../components/primitives';

export const metadata: Metadata = {
  title: 'KORA signature techniques',
  robots: { index: false, follow: false },
};

/**
 * One page per technique from PART 2, so each can be checked on its own at
 * 1440, 1024 and 375. 2.2 is not here: the page ships no logo marquee.
 */
export default function TechniquesPage() {
  return (
    <main className="tech">
      <section className="mk-container tech__block">
        <p className="t-meta tech__label">
          2.1 highlight-block headline · box-decoration-break: clone
        </p>
        <h1 className="hero-h1 t-hero">
          <span className="hero-badge">
            <Mark size={72} />
          </span>
          <span className="hl hl--light">Support that</span>
          <br />
          <span className="hl hl--dark">proves it worked</span>
        </h1>
      </section>

      <section className="mk-container tech__block">
        <p className="t-meta tech__label">
          2.1 wrap check · the same block forced to wrap, padding must survive the break
        </p>
        <p className="t-pillar tech__wrap">
          <span className="hl hl--dark">
            A long line that has to wrap at least once so the clone value can be seen doing its job
          </span>
        </p>
      </section>

      <section className="tech__block">
        <p className="mk-container t-meta tech__label">
          2.3 angular section transition · two shapes
        </p>
        <div className="band tech__band" />
      </section>

      <section className="tech__block tech__dots">
        <p className="mk-container t-meta tech__label">2.4 halftone dot grid · hero corners only</p>
        <Dots style={{ left: 16, top: 48 }} />
        <Dots style={{ right: 16, top: 48 }} />
      </section>

      <section className="tech__block">
        <p className="mk-container t-meta tech__label">2.5 offset card over band</p>
        <div className="band tech__band tech__band--cta">
          <div className="mk-container">
            <div className="offset-card">
              <div className="offset-card__inner">
                <p className="t-section tech__cta-copy">
                  Stop guessing whether
                  <br />
                  your agent worked.
                </p>
                <Pill href="#">Talk to us</Pill>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
