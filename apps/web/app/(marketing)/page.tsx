import { ProofCard } from '@/components/kora/proof-card';
import { Nav } from './components/nav';
import { Footer } from './components/footer';
import { ChatFragment, ChecksFragment, PipelineFragment } from './components/fragments';
import { Pill } from './components/primitives';

const SCHEMA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': '#organization',
      name: 'Kora',
      description: 'Money operations for subscriptions, proven in Stripe.',
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Kora',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description:
        'Kora handles refunds, cancellations and plan changes for subscription businesses, then reads Stripe back to confirm each action landed.',
      publisher: { '@id': '#organization' },
    },
  ],
};

function ActionToProofDiagram() {
  return (
    <svg
      aria-label="Action to proof: request, execute, read back, confirmed"
      className="proof-diagram"
      role="img"
      viewBox="0 0 640 120"
    >
      {[
        { x: 8, label: 'Request' },
        { x: 168, label: 'Execute' },
        { x: 328, label: 'Read back' },
        { x: 488, label: 'Confirmed' },
      ].map((node, i) => (
        <g key={node.label}>
          {i < 3 ? (
            <line
              x1={node.x + 136}
              y1="60"
              x2={node.x + 160}
              y2="60"
              stroke="#111418"
              strokeWidth="2"
            />
          ) : null}
          {i < 3 ? (
            <path
              d={`M ${node.x + 152} 54 L ${node.x + 160} 60 L ${node.x + 152} 66`}
              fill="none"
              stroke="#111418"
              strokeWidth="2"
            />
          ) : null}
          <rect
            x={node.x}
            y="24"
            width="136"
            height="72"
            fill={i === 3 ? '#3B4CCA' : '#FCFCFD'}
            stroke="#E4E7EC"
            strokeWidth="1"
          />
          <text
            x={node.x + 68}
            y="52"
            textAnchor="middle"
            fontFamily="Geist Mono, ui-monospace, monospace"
            fontSize="12"
            fill={i === 3 ? '#FCFCFD' : '#6a6a6f'}
          >
            {`0${i + 1}`}
          </text>
          <text
            x={node.x + 68}
            y="74"
            textAnchor="middle"
            fontFamily="Geist, system-ui, sans-serif"
            fontSize="14"
            fontWeight="600"
            fill={i === 3 ? '#FCFCFD' : '#111418'}
          >
            {node.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

const DIFFERENTIATORS = [
  {
    id: 'acts',
    title: 'Kora acts',
    body: 'Refunds, cancellations and plan changes run through one pipeline with the policy check before the write and the claim key on every call. A retried request never creates a second refund.',
    figure: <PipelineFragment />,
  },
  {
    id: 'proves',
    title: 'Kora proves',
    body: 'A 200 response is not proof. Kora reads the refund or subscription back from Stripe and compares it. The Proof Card shows requested, executed and verified, with the Stripe reference attached.',
    figure: <ChatFragment />,
  },
  {
    id: 'never-lies',
    title: 'Kora never lies about money',
    body: 'A refund still waiting on Stripe says waiting on Stripe. A denial names the rule in plain words. A failure brings in a person. The customer never hears that money moved when it did not.',
    figure: <ChecksFragment />,
  },
];

export default function MarketingPage() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <section className="hero">
          <div className="mk-container hero__grid">
            <div className="hero__left">
              <h1 className="hero-serif t-hero">Refunds and cancellations, proven in Stripe.</h1>
              <p className="t-lead hero__lead">
                Kora handles the money operations of your subscription business, then reads Stripe
                back to confirm each one landed. Refund confirmed means confirmed.
              </p>
              <Pill href="/ops/connect">Connect Stripe</Pill>
            </div>
            <div className="hero__right">
              <div>
                <ProofCard
                  amountMinor={349900}
                  currency="INR"
                  policyRule="Within the 30-day window and under the approval threshold."
                  status="verified"
                  stripeId="re_1S7xQ2mK9pL4test"
                  title="Refund confirmed"
                  verifiedAt={new Date('2026-08-14T10:24:00Z')}
                />
                <p className="t-meta hero__caption">
                  A real confirmation: requested, executed, read back from Stripe.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mk-section" id="different">
          <div className="mk-container">
            <h2 className="t-section section-heading">Three things that make Kora different</h2>
            <div className="pillars">
              {DIFFERENTIATORS.map((item) => (
                <section className="panel pillar" id={item.id} key={item.id}>
                  <h3 className="t-pillar pillar__title">{item.title}</h3>
                  <p className="t-body pillar__body">{item.body}</p>
                  {item.figure}
                </section>
              ))}
            </div>
          </div>
        </section>

        <section className="mk-section" id="action-to-proof">
          <div className="mk-container">
            <h2 className="t-section section-heading">From action to proof</h2>
            <p className="t-body console__lead">
              Every money action ends the same way: the write, then a read-back, then the word
              confirmed only when Stripe agrees. Cancellation scheduled for 14 June is a date from
              the subscription record, not a promise from the transcript.
            </p>
            <ActionToProofDiagram />
          </div>
        </section>

        <section className="cta">
          <div className="band cta__bg" aria-hidden="true" />
          <div className="mk-container cta__inner">
            <div className="offset-card">
              <div className="offset-card__inner">
                <h2 className="t-section cta__copy">Prove your next refund landed.</h2>
                <Pill href="/ops/connect">Connect Stripe</Pill>
              </div>
            </div>
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
