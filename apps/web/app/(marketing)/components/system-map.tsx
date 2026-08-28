'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

/**
 * One run of the agent, drawn end to end, with the return path that makes it a
 * cycle rather than a pipeline.
 *
 * Everything named here is read from the repository:
 *  - the thirteen gate stages are the numbered steps in packages/tools/src/pipeline.ts
 *  - the four tabs are real files in scenarios/, by id
 *  - nine checks is the length of CHECKS in packages/evaluation/src/checks
 *  - the return path claims replay and promote because `replay()`,
 *    `pnpm kora replay`, `agent:promote` and `agent:rollback` all exist
 */

/** The numbered stages of `runTool`, in the order the pipeline runs them. */
const PIPELINE = [
  'resolve version',
  'validate input',
  'permission check',
  'policy check',
  'limited-mode caps',
  'approval gate',
  'deployment mode gate',
  'circuit breaker',
  'idempotency claim',
  'execute',
  'validate output',
  'verify',
  'settle idempotency',
];

/** Where each scenario stops, as an index into PIPELINE. */
const POLICY_STAGE = 3;
const VERIFY_STAGE = 11;

type Scenario = {
  id: string;
  tab: string;
  file: string;
  decision: string;
  rule: string | null;
  reaches: number;
  held: boolean;
  outcome: string;
  verified: boolean;
  asserted: number;
  writeVerified: string;
  tone: 'signal' | 'neutral' | 'rust';
  path: string;
};

/**
 * The full route: inputs, into the rule engine, down the gate, out to the
 * checks, then back round the return curve.
 */
const FULL =
  'M 230 232 H 415 V 436 H 715 V 480 H 1050 V 566 Q 1050 590 1026 590 H 439 Q 415 590 415 566 V 232';
/** Denied stops where the rule engine stopped it. */
const TO_POLICY = 'M 230 232 H 415 V 436';
/** A failed read-back reaches the checks and goes no further. */
const TO_PROVE = 'M 230 232 H 415 V 436 H 715 V 480 H 1050';

const SCENARIOS: Scenario[] = [
  {
    id: 'H1',
    tab: 'Resolved',
    file: 'damaged_order_within_policy',
    decision: 'allow',
    rule: 'standard_replacement',
    reaches: PIPELINE.length,
    held: false,
    outcome: 'RESOLVED',
    verified: true,
    asserted: 7,
    writeVerified: 'MET',
    tone: 'signal',
    path: FULL,
  },
  {
    id: 'H2',
    tab: 'Held for a person',
    file: 'damaged_order_above_approval_threshold',
    decision: 'require_approval',
    rule: 'high_value_needs_approval',
    reaches: PIPELINE.length,
    held: true,
    outcome: 'RESOLVED',
    verified: true,
    asserted: 3,
    writeVerified: 'MET',
    tone: 'signal',
    path: FULL,
  },
  {
    id: 'N2',
    tab: 'Denied by policy',
    file: 'return_window_expired',
    decision: 'deny',
    rule: 'outside_return_window',
    reaches: POLICY_STAGE + 1,
    held: false,
    outcome: 'RESOLVED',
    verified: false,
    asserted: 3,
    writeVerified: '—',
    tone: 'neutral',
    path: TO_POLICY,
  },
  {
    id: 'N7',
    tab: 'Read-back failed',
    file: 'verification_failure',
    decision: 'allow',
    rule: 'standard_replacement',
    reaches: VERIFY_STAGE + 1,
    held: false,
    outcome: 'NEEDS_HUMAN',
    verified: false,
    asserted: 2,
    writeVerified: 'UNMET',
    tone: 'rust',
    path: TO_PROVE,
  },
];

const INPUTS = [
  { label: 'customer message', x: 8, y: 96 },
  { label: 'order record', x: 26, y: 170 },
  { label: 'policy file', x: 0, y: 244 },
  { label: 'knowledge docs', x: 20, y: 318 },
];

const CAPTIONS = [
  {
    head: 'Inputs',
    body: 'The request, the order record, and a rule file the agent does not get to argue with.',
  },
  {
    head: 'Decide',
    body: 'Intent detection with a confidence score. Below the threshold it goes to a person instead of guessing.',
  },
  {
    head: 'Act',
    body: 'Every write is validated, permission-checked, deduplicated and timed out. There is no second path to your business API.',
  },
  {
    head: 'Prove',
    body: 'The action is not finished until the business system confirms it. When it cannot, the agent stops talking and gets a person.',
  },
];

function Row({ y, label, lit, held }: { y: number; label: string; lit: boolean; held?: boolean }) {
  const cls = ['map__stage', !lit && 'map__stage--dim', held && 'map__approval']
    .filter(Boolean)
    .join(' ');
  return (
    <g className={cls}>
      <rect x={616} y={y - 5} width={7} height={7} />
      <text x={634} y={y} className="map__mono">
        {label}
        {held ? ' · a person' : ''}
      </text>
    </g>
  );
}

export function SystemMap() {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const bandRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = bandRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!auto || !inView) return;
    const t = setInterval(() => setActive((i) => (i + 1) % SCENARIOS.length), 8000);
    return () => clearInterval(t);
  }, [auto, inView]);

  const s = SCENARIOS[active];

  return (
    <div
      className="map"
      ref={bandRef}
      data-tone={s.tone}
      data-held={s.held ? 'yes' : 'no'}
      data-running={inView ? 'yes' : 'no'}
    >
      <div className="mk-container">
        <div className="map__head">
          <span className="map__badge">
            <span className="map__badge-dot" aria-hidden="true" />
            KORA · ONE RUN, END TO END
          </span>
          <span className="map__head-note">DETERMINISTIC BY DESIGN</span>
        </div>

        <div className="map__tabs" role="tablist" aria-label="Run scenarios">
          {SCENARIOS.map((sc, i) => (
            <button
              key={sc.id}
              type="button"
              role="tab"
              id={`map-tab-${sc.id}`}
              aria-selected={i === active}
              aria-controls="map-stage"
              className={`map__tab${i === active ? ' map__tab--on' : ''}`}
              onClick={() => {
                setActive(i);
                setAuto(false);
              }}
            >
              {sc.tab}
              <span className="sr-only">
                {' '}
                — scenario {sc.id}, {sc.file}
              </span>
            </button>
          ))}
        </div>

        <div
          className="map__stage-wrap"
          id="map-stage"
          role="tabpanel"
          aria-labelledby={`map-tab-${s.id}`}
        >
          <svg className="map__svg" viewBox="0 0 1216 640" xmlns="http://www.w3.org/2000/svg">
            <title>
              {`Scenario ${s.id}, ${s.file}: policy ${s.decision}, outcome ${s.outcome}`}
            </title>

            {['INPUTS', 'DECIDE', 'ACT', 'PROVE'].map((h, i) => (
              <text key={h} x={[0, 300, 600, 900][i]} y={22} className="map__colhead">
                {h}
              </text>
            ))}

            {/* dashed connectors between the columns */}
            {[
              [232, 232, 298],
              [436, 532, 598],
              [480, 832, 898],
            ].map(([y, x1, x2]) => (
              <g key={`${x1}-${y}`}>
                <line x1={x1} y1={y} x2={x2 - 8} y2={y} className="map__link" />
                <path
                  d={`M ${x2 - 8} ${y - 4} L ${x2} ${y} L ${x2 - 8} ${y + 4} Z`}
                  className="map__arrow"
                />
              </g>
            ))}

            {INPUTS.map((t) => (
              <g key={t.label} className="map__node">
                <rect x={t.x} y={t.y} width={200} height={42} rx={4} />
                <text x={t.x + 16} y={t.y + 26} className="map__mono">
                  {t.label}
                </text>
              </g>
            ))}

            <g className="map__node map__box">
              <rect x={300} y={56} width={230} height={468} rx={4} />
            </g>
            <g className="map__node">
              <rect x={316} y={92} width={198} height={40} rx={4} />
              <text x={332} y={117} className="map__mono">
                intent
              </text>
            </g>
            <g className="map__node">
              <rect x={316} y={144} width={198} height={40} rx={4} />
              <text x={332} y={169} className="map__mono">
                retrieval
              </text>
            </g>
            {/* The only node in this column carrying a signal colour. */}
            <g className="map__node map__policy">
              <rect x={316} y={380} width={198} height={112} rx={4} />
              <text x={332} y={410} className="map__label">
                POLICY ENGINE
              </text>
              <text x={332} y={440} className="map__mono">
                acme_damaged_order
              </text>
              <text x={332} y={464} className="map__mono map__mono--dim">
                1.0.0 · {s.decision}
              </text>
            </g>
            <text x={300} y={556} className="map__caption-in">
              a compiled rule file, not a prompt
            </text>

            <g className="map__node map__box">
              <rect x={600} y={56} width={230} height={468} rx={4} />
            </g>
            {PIPELINE.map((label, i) => (
              <Row
                key={label}
                y={96 + i * 32}
                label={label}
                lit={i < s.reaches}
                held={s.held && label === 'approval gate'}
              />
            ))}

            <line x1={900} y1={268} x2={1216} y2={268} className="map__rule" />
            {[
              ['CHECKS', `9 run · ${s.asserted} asserted`],
              ['WRITE_VERIFIED', s.writeVerified],
              ['OUTCOME', s.outcome],
            ].map(([label, value], i) => (
              <g key={label}>
                <text x={900} y={300 + i * 80} className="map__label">
                  {label}
                </text>
                <text
                  x={900}
                  y={332 + i * 80}
                  className={`map__value${label === 'OUTCOME' ? ' map__value--tone' : ''}`}
                >
                  {value}
                </text>
              </g>
            ))}

            {/* the return path: what makes this a cycle */}
            <path
              d="M 1050 524 V 566 Q 1050 590 1026 590 H 439 Q 415 590 415 566 V 524"
              className="map__return"
            />
            <text x={676} y={614} className="map__mono map__mono--dim">
              replay · promote
            </text>

            <circle
              r={4}
              className="map__dot"
              style={{ offsetPath: `path("${s.path}")` } as CSSProperties}
            />
          </svg>

          {/* Below 1280 the flow runs top to bottom instead of being shrunk. */}
          <ol className="map__stack">
            <li>
              <p className="map__label">INPUTS</p>
              <p className="map__mono">{INPUTS.map((i) => i.label).join(' · ')}</p>
            </li>
            <li>
              <p className="map__label">DECIDE</p>
              <p className="map__mono">
                intent · retrieval · acme_damaged_order 1.0.0 · {s.decision}
              </p>
            </li>
            <li>
              <p className="map__label">ACT</p>
              <p className="map__mono">
                {PIPELINE.slice(0, s.reaches).join(' · ')}
                {s.reaches < PIPELINE.length ? ' · stopped' : ''}
              </p>
            </li>
            <li>
              <p className="map__label">PROVE</p>
              <p className="map__mono">
                9 run · {s.asserted} asserted · write_verified {s.writeVerified} · {s.outcome}
              </p>
            </li>
            <li className="map__stack-return">
              <p className="map__mono map__mono--dim">replay · promote</p>
            </li>
          </ol>
        </div>

        <div className="map__captions">
          {CAPTIONS.map((c) => (
            <div className="map__caption" key={c.head}>
              <p className="map__caption-head">{c.head}</p>
              <p className="map__caption-body">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
