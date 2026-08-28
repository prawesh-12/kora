import type { Metadata } from 'next';
import { CONTACT, Nav } from '../components/nav';
import { Footer } from '../components/footer';
import {
  BrokenTraceScene,
  DrillScene,
  FailuresScene,
  OverviewScene,
} from '../components/console-scenes';
import { Eyebrow, Pill } from '../components/primitives';

export const metadata: Metadata = {
  title: 'KORA operator console — from a number that moved to the run that moved it',
  description:
    'An operator sees the escalation rate move, finds the failure code behind it, opens every run with that code, and reads the step that broke. Three clicks.',
  alternates: { canonical: '/console' },
};

const SCENES = [
  {
    id: 'overview',
    eyebrow: 'Scene one',
    title: 'Something is wrong',
    body: 'The console opens on the number an operator watches. Verified Resolution Rate is the share of finished runs the business system confirmed, and the denominator sits beside it because a percentage over a handful of runs is not a number to act on. Escalation has moved, so that is where the morning goes.',
    scene: <OverviewScene />,
    wide: false,
  },
  {
    id: 'failures',
    eyebrow: 'Scene two',
    title: 'Which failure',
    body: 'One bar per primary failure code. Length is how often it happened and colour is how serious it is, so the rarest code can still be the loudest row: a policy failure twice is worse than a knowledge gap sixty-four times. Only the classifier’s first code is counted, or one broken read is tallied again as a bad outcome and the tallest bar is the symptom furthest from the fix.',
    scene: <FailuresScene />,
    wide: false,
  },
  {
    id: 'conversations',
    eyebrow: 'Scene three',
    title: 'Which conversations',
    body: 'Opening a bar is one click, and it lands on every run behind it with the filter already applied. Paging is by keyset, so a run that arrives while an operator is reading does not shift the rows under them.',
    scene: <DrillScene />,
    wide: true,
  },
  {
    id: 'trace',
    eyebrow: 'Scene four',
    title: 'Exactly where it broke',
    body: 'The trace names the step, the error the dependency returned, both attempts, and the escalation that followed. Nothing was written, and the run says so. Nobody is grepping logs to find out which of eleven steps failed.',
    scene: <BrokenTraceScene />,
    wide: false,
  },
];

export default function ConsolePage() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <section className="mk-section" id="console">
          <div className="mk-container">
            <Eyebrow>The operator console</Eyebrow>
            <h1 className="section-heading t-section">
              From a number that moved to the run that moved it
            </h1>
            <p className="t-lead console__lead">
              Three clicks. The console is not a dashboard you read, it is a path you walk, and
              every step of it names something the code actually recorded.
            </p>
          </div>
        </section>

        {SCENES.map((s) => (
          <section className="mk-section scene" id={s.id} key={s.id}>
            <div className={`mk-container scene__grid${s.wide ? ' scene__grid--wide' : ''}`}>
              <div className="scene__prose">
                <Eyebrow>{s.eyebrow}</Eyebrow>
                <h2 className="t-pillar scene__title">{s.title}</h2>
                <p className="t-body scene__body">{s.body}</p>
              </div>
              <div className="scene__stage">{s.scene}</div>
            </div>
          </section>
        ))}

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
            <svg className="cta__shape" viewBox="0 0 440 340" aria-hidden="true">
              <g transform="rotate(-12 220 170)">
                {[0, 1, 2, 3].map((i) => (
                  <g key={i} transform={`translate(${70 + i * 14} ${34 + i * 72})`}>
                    <rect width="300" height="60" rx="4" fill="var(--paper)" />
                    <rect
                      x="18"
                      y="18"
                      width="24"
                      height="24"
                      fill={['var(--cobalt)', 'var(--amber)', 'var(--signal)', 'var(--signal)'][i]}
                    />
                    <rect x="58" y="20" width="132" height="8" fill="var(--border)" />
                    <rect x="58" y="36" width="86" height="8" fill="var(--border)" />
                  </g>
                ))}
              </g>
            </svg>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
