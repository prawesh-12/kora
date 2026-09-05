import { ProofCard } from '@/components/kora/proof-card';
import { ActionToProofDiagram, PipelineGates, ReadBackLadder } from './components/figures';
import { Footer } from './components/footer';
import { CONNECT, Nav } from './components/nav';
import { ActionLink } from './components/primitives';

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

const DIFFERENTIATORS = [
  {
    title: 'Kora acts',
    body: 'Refunds, cancellations and plan changes run through one pipeline with the policy check before the write and the claim key on every call. A retried request never creates a second refund.',
    figure: <PipelineGates />,
  },
  {
    title: 'Kora proves',
    body: 'A 200 response is not proof. Kora reads the refund or subscription back from Stripe and compares it. Only an exact match on amount, currency and status is allowed to say confirmed.',
    figure: <ReadBackLadder />,
  },
  {
    title: 'Kora never lies about money',
    body: 'A refund still waiting on Stripe says waiting on Stripe. A denial names the rule in plain words. A failure brings in a person. The customer never hears that money moved when it did not.',
    figure: (
      <div className="states">
        <ProofCard
          amountMinor={129900}
          currency="INR"
          policyRule="Within the 30-day window and under the approval threshold."
          status="pending"
          stripeId="re_1S8aB4mK9pL4test"
          title="Refund submitted"
        />
        <ProofCard
          amountMinor={890000}
          currency="INR"
          failureReason="The invoice was paid 94 days ago."
          policyRule="Refunds are allowed within 30 days of payment."
          status="denied"
          title="Refund not issued"
        />
      </div>
    ),
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
            <div>
              <h1 className="t-hero">Refunds and cancellations, proven in Stripe.</h1>
              <p className="t-lead hero__lead">
                Kora handles the money operations of your subscription business, then reads Stripe
                back to confirm each one landed. Refund confirmed means confirmed.
              </p>
              <div className="hero__actions">
                <ActionLink href={CONNECT}>Connect Stripe</ActionLink>
              </div>
            </div>
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
        </section>

        <section className="mk-section" id="how">
          <div className="mk-container">
            <h2 className="t-section section-heading">Three things that make Kora different</h2>
            {DIFFERENTIATORS.map((item) => (
              <section className="pillar" key={item.title}>
                <div>
                  <h3 className="t-pillar">{item.title}</h3>
                  <p className="t-body pillar__body">{item.body}</p>
                </div>
                {item.figure}
              </section>
            ))}
          </div>
        </section>

        <section className="mk-section rule-top" id="proof">
          <div className="mk-container">
            <h2 className="t-section section-heading">From action to proof</h2>
            <p className="t-body section-lead">
              Every money action ends the same way: the write, then a read-back, then the word
              confirmed only when Stripe agrees. Cancellation scheduled for 14 June is a date from
              the subscription record, not a promise from the transcript.
            </p>
            <ActionToProofDiagram />
          </div>
        </section>

        <section className="close">
          <div className="mk-container close__inner">
            <h2 className="t-section close__copy">Prove your next refund landed.</h2>
            <ActionLink href={CONNECT} tone="onink">
              Connect Stripe
            </ActionLink>
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
