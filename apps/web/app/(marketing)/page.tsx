import { CONTACT, Nav } from './components/nav';
import { Footer } from './components/footer';
import { Reveal } from './components/reveal';
import { TraceFragment } from './components/trace';
import {
  ActGlyph,
  BrokenLogGlyph,
  BubbleGlyph,
  ChevronGlyph,
  DuplicateGlyph,
  EmptyResultGlyph,
  EvaluateGlyph,
  ImproveGlyph,
  PlayGlyph,
  VerifyGlyph,
} from './components/glyphs';
import {
  ChatFragment,
  ChecksFragment,
  ConfigBlock,
  PipelineFragment,
  PolicyCheckCell,
  ReplayFragment,
  RouteRows,
  ScoreCell,
  SignalChipsCell,
  VerifiedCell,
} from './components/fragments';
import { Dots, Eyebrow, IconTile, Mark, Pill, SectionHeading } from './components/primitives';

const PROBLEMS = [
  {
    glyph: <EmptyResultGlyph />,
    claim: 'Your agent said it issued the refund.',
    reality: 'Nobody checked whether the refund exists.',
  },
  {
    glyph: <BubbleGlyph />,
    claim: 'Your refund policy lives in a prompt.',
    reality: 'So a customer can argue with it.',
  },
  {
    glyph: <DuplicateGlyph />,
    claim: 'A retry created a second refund.',
    reality: 'You found out from the customer, not the dashboard.',
  },
  {
    glyph: <BrokenLogGlyph />,
    claim: 'A run failed and the log says 500.',
    reality: 'Which of the eleven steps broke is anyone’s guess.',
  },
];

const STEPS = [
  {
    title: 'Understand the request.',
    body: 'Intent detection with a confidence score. Below the threshold it goes to a person instead of guessing.',
  },
  {
    title: 'Check the policy in code.',
    body: 'A deterministic rule engine decides. Facts come from the order record, never from what the model or the customer claims.',
  },
  {
    title: 'Act through one gate.',
    body: 'Every write is validated, permission-checked, deduplicated and timed out. There is no second path to your business API.',
  },
  {
    title: 'Read it back.',
    body: 'The action is not finished until the business system confirms it. When it cannot, the agent stops talking and gets a person.',
  },
];

const PILLARS = [
  {
    id: 'act',
    glyph: <ActGlyph />,
    title: 'Act',
    body: 'Every external action runs through a single pipeline: schema validation, permission check, policy check, idempotency claim, timeout, output validation. A retried request never creates a second refund.',
    figure: <PipelineFragment />,
  },
  {
    id: 'verify',
    glyph: <VerifyGlyph />,
    title: 'Verify',
    body: 'A 200 response is not proof that anything changed. KORA reads the entity back and compares it. If the read-back disagrees, the agent stops and a person takes over.',
    figure: <ChatFragment />,
  },
  {
    id: 'evaluate',
    glyph: <EvaluateGlyph />,
    title: 'Evaluate',
    body: 'Every finished run is scored against your business system, not against the transcript. Nine deterministic checks run on all of it. Verified Resolution Rate is one number you can act on.',
    figure: <ChecksFragment />,
  },
  {
    id: 'improve',
    glyph: <ImproveGlyph />,
    title: 'Improve',
    body: 'Replay real conversations against a new configuration before it ships. See the regressions before your customers do.',
    figure: <ReplayFragment />,
  },
];

const SCHEMA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': '#organization',
      name: 'KORA',
      description: 'Customer support automation with verified outcomes.',
    },
    {
      '@type': 'SoftwareApplication',
      name: 'KORA',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description:
        'KORA resolves customer requests end to end, then reads the business system back to confirm the action landed. Policy runs in code and every run is scored against what really happened.',
      publisher: { '@id': '#organization' },
    },
  ],
};

export default function MarketingPage() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        {/* 3.2 */}
        <section className="hero">
          <Dots style={{ left: 16, top: 48 }} />
          <Dots style={{ right: 16, top: 48 }} />
          <div className="mk-container hero__grid">
            <div className="hero__left">
              <h1 className="hero-h1 t-hero">
                <span className="hero-badge">
                  <Mark size={72} />
                </span>
                <span className="hl hl--light">Support that</span>
                <br />
                <span className="hl hl--dark">proves it worked</span>
              </h1>
            </div>
            <div className="hero__right">
              <p className="t-lead hero__lead">
                KORA resolves customer requests end to end, then reads your business system back to
                confirm the refund landed. Policy runs in code, not a prompt. Every run is scored
                against what happened.
              </p>
              <Pill href="#trace" icon={<PlayGlyph />}>
                Watch a 2-minute trace
              </Pill>
            </div>
          </div>
        </section>

        {/* 3.4 */}
        <section className="product-band" id="trace">
          <div className="band product-band__bg" aria-hidden="true" />
          <div className="mk-container product-band__inner">
            <TraceFragment />
          </div>
        </section>

        {/* 3.5 */}
        <Reveal>
          <section className="mk-section" id="why">
            <div className="mk-container">
              <Eyebrow>Why we made this</Eyebrow>
              <SectionHeading>
                Most AI support agents cannot tell you whether they worked
              </SectionHeading>
              <ul className="problems">
                {PROBLEMS.map((p) => (
                  <li className="problems__card" key={p.claim}>
                    <IconTile fill="var(--amber)">{p.glyph}</IconTile>
                    <p className="t-card problems__copy">
                      <strong>{p.claim}</strong> <span>{p.reality}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </Reveal>

        {/* 3.6 */}
        <Reveal>
          <section className="mk-section" id="how-it-works">
            <div className="mk-container">
              <Eyebrow>How it works</Eyebrow>
              <SectionHeading>From request to verified outcome</SectionHeading>
              <div className="how">
                <div className="panel how__panel">
                  {STEPS.map((step, i) => (
                    <details className="acc" name="how-it-works" key={step.title} open={i === 0}>
                      <summary className="acc__summary">
                        <span className="t-accordion acc__title">{step.title}</span>
                        <ChevronGlyph />
                      </summary>
                      <div className="acc__body">
                        <p className="t-body acc__text">{step.body}</p>
                      </div>
                    </details>
                  ))}
                </div>
                <div className="how__grid">
                  <PolicyCheckCell />
                  <SignalChipsCell />
                  <ScoreCell />
                  <VerifiedCell />
                </div>
              </div>
            </div>
          </section>
        </Reveal>

        {/* 3.7 */}
        <Reveal>
          <section className="mk-section" id="pillars">
            <div className="mk-container">
              <Eyebrow>How we do it</Eyebrow>
              <SectionHeading>Four things that make an answer trustworthy</SectionHeading>
              <div className="pillars">
                {PILLARS.map((pillar) => (
                  <section className="panel pillar" id={pillar.id} key={pillar.id}>
                    <span className="pillar__glyph" aria-hidden="true">
                      {pillar.glyph}
                    </span>
                    <h3 className="t-pillar pillar__title">{pillar.title}</h3>
                    <p className="t-body pillar__body">{pillar.body}</p>
                    {pillar.figure}
                  </section>
                ))}
              </div>
            </div>
          </section>
        </Reveal>

        {/* 3.8 */}
        <Reveal>
          <section className="mk-section" id="integrations">
            <div className="mk-container integrations">
              <div className="integrations__left">
                <Eyebrow>Fits in everywhere</Eyebrow>
                <SectionHeading>Connects to the systems you already run</SectionHeading>
                <p className="t-body integrations__body">
                  KORA reaches your order system over MCP or a plain HTTP API. Whichever way you
                  connect it, the same rule engine decides, the same read-back confirms, and the
                  same trace comes out the other end.
                </p>
                <div className="integrations__actions">
                  <Pill href="#trace">See all integrations</Pill>
                  <Pill href="#how-it-works" variant="secondary">
                    Read the docs
                  </Pill>
                </div>
              </div>
              <div className="integrations__right">
                <ul className="tiles" aria-hidden="true">
                  <li className="tiles__tile" style={{ background: 'var(--rust)' }} />
                  <li className="tiles__tile" style={{ background: 'var(--cobalt)' }} />
                  <li className="tiles__tile" style={{ background: 'var(--ink)' }} />
                  <li className="tiles__tile" style={{ background: 'var(--signal)' }} />
                </ul>
                <ConfigBlock />
                <RouteRows />
              </div>
            </div>
          </section>
        </Reveal>

        {/* 3.9 */}
        <section className="cta">
          <div className="band cta__bg" aria-hidden="true" />
          <div className="mk-container cta__inner">
            <div className="offset-card">
              <div className="offset-card__inner">
                <h2 className="t-section cta__copy">
                  Stop guessing whether
                  <br />
                  your agent worked.
                </h2>
                <Pill href={CONTACT}>Talk to us</Pill>
              </div>
            </div>
            <svg className="cta__shape" viewBox="0 0 420 320" aria-hidden="true">
              <g transform="rotate(15 210 160)">
                <rect x="40" y="40" width="300" height="90" fill="var(--rust)" />
                <rect x="80" y="115" width="300" height="90" fill="var(--cobalt)" />
                <rect x="30" y="190" width="300" height="90" fill="var(--rust)" />
              </g>
            </svg>
          </div>
        </section>
      </main>
      <Footer />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: structured data is a fixed literal
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SCHEMA) }}
      />
    </>
  );
}
