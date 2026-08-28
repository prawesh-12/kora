'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

/**
 * One run of the agent at hero scale: what goes in, what decides, what it does,
 * and what proves it, with the return path that makes it a cycle.
 *
 * Deliberately three items a column. The full thirteen-stage gate lives in the
 * Act pillar further down the page, where there is room for it; here the three
 * stages that carry the argument are enough, and a wall of rows in a 500px
 * panel is not a diagram.
 *
 * Everything named is read from the repository: the stages are steps 4, 10 and
 * 12 of `runTool` in packages/tools/src/pipeline.ts, the four tabs are files in
 * scenarios/ by id, and nine is the length of CHECKS in packages/evaluation.
 */

/** Steps 4, 10 and 12 of the tool pipeline. */
const ACT = ['policy check', 'execute', 'verify'];
const POLICY_STEP = 0;
const VERIFY_STEP = 2;

type Scenario = {
  id: string;
  tab: string;
  file: string;
  decision: string;
  reaches: number;
  held: boolean;
  outcome: string;
  checks: string;
  tone: 'signal' | 'neutral' | 'rust';
  path: string;
};

const FULL = 'M 102 96 H 193 V 207 H 500 V 330 Q 500 350 480 350 H 148 Q 128 350 128 330 V 96';
const TO_POLICY = 'M 102 96 H 193 V 207';
const TO_PROVE = 'M 102 96 H 193 V 207 H 500';

const SCENARIOS: Scenario[] = [
  {
    id: 'H1',
    tab: 'Resolved',
    file: 'damaged_order_within_policy',
    decision: 'allow',
    reaches: ACT.length,
    held: false,
    outcome: 'RESOLVED',
    checks: '9 checks',
    tone: 'signal',
    path: FULL,
  },
  {
    id: 'H2',
    tab: 'Held for a person',
    file: 'damaged_order_above_approval_threshold',
    decision: 'require_approval',
    reaches: ACT.length,
    held: true,
    outcome: 'RESOLVED',
    checks: '9 checks',
    tone: 'signal',
    path: FULL,
  },
  {
    id: 'N2',
    tab: 'Denied by policy',
    file: 'return_window_expired',
    decision: 'deny',
    reaches: POLICY_STEP + 1,
    held: false,
    outcome: 'RESOLVED',
    checks: '9 checks',
    tone: 'neutral',
    path: TO_POLICY,
  },
  {
    id: 'N7',
    tab: 'Read-back failed',
    file: 'verification_failure',
    decision: 'allow',
    reaches: VERIFY_STEP + 1,
    held: false,
    outcome: 'NEEDS_HUMAN',
    checks: '9 checks',
    tone: 'rust',
    path: TO_PROVE,
  },
];

export function SystemMap() {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [inView, setInView] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.2 });
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
      ref={panelRef}
      data-tone={s.tone}
      data-held={s.held ? 'yes' : 'no'}
      data-running={inView ? 'yes' : 'no'}
    >
      <div className="map__head">
        <span className="map__badge">
          <span className="map__badge-dot" aria-hidden="true" />
          KORA · ONE RUN
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
          </button>
        ))}
      </div>

      {/* Replaces the SVG <title>, which browsers render as a tooltip over the diagram. */}
      {/* Where the policy identity lives: the node is too narrow to hold it. */}
      <p className="map__scenario">
        {s.id} · acme_damaged_order 1.0.0 · {s.decision}
      </p>

      <div id="map-stage" role="tabpanel" aria-labelledby={`map-tab-${s.id}`}>
        {/* biome-ignore lint/a11y/noSvgWithoutTitle: a <title> renders as a tooltip
            across the diagram; the scenario line above names the run, and the
            stacked list below is the text equivalent. */}
        <svg className="map__svg" viewBox="0 0 560 400" xmlns="http://www.w3.org/2000/svg">
          {['INPUTS', 'DECIDE', 'ACT', 'PROVE'].map((h, i) => (
            <text key={h} x={[0, 128, 286, 444][i]} y={16} className="map__colhead">
              {h}
            </text>
          ))}

          {[
            [96, 102, 126],
            [207, 260, 284],
            [207, 418, 442],
          ].map(([y, x1, x2]) => (
            <g key={`${x1}-${y}`}>
              <line x1={x1} y1={y} x2={x2 - 6} y2={y} className="map__link" />
              <path
                d={`M ${x2 - 6} ${y - 3.5} L ${x2} ${y} L ${x2 - 6} ${y + 3.5} Z`}
                className="map__arrow"
              />
            </g>
          ))}

          {[
            { label: 'message', x: 0, y: 62 },
            { label: 'order', x: 10, y: 110 },
          ].map((t) => (
            <g key={t.label} className="map__node">
              <rect x={t.x} y={t.y} width={92} height={30} rx={4} />
              <text x={t.x + 12} y={t.y + 20} className="map__mono">
                {t.label}
              </text>
            </g>
          ))}

          <g className="map__node map__box">
            <rect x={128} y={50} width={130} height={240} rx={4} />
          </g>
          <g className="map__node">
            <rect x={140} y={64} width={106} height={30} rx={4} />
            <text x={152} y={84} className="map__mono">
              intent
            </text>
          </g>
          {/* The one node in this column with a colour, because it is the difference. */}
          <g className="map__node map__policy">
            <rect x={140} y={180} width={106} height={54} rx={4} />
            <text x={150} y={203} className="map__label">
              POLICY ENGINE
            </text>
            <text x={150} y={222} className="map__mono map__mono--sm map__mono--dim">
              1.0.0
            </text>
          </g>
          <text x={128} y={312} className="map__caption-in">
            a rule file, not a prompt
          </text>

          <g className="map__node map__box">
            <rect x={286} y={50} width={130} height={240} rx={4} />
          </g>
          {ACT.map((label, i) => {
            const y = 96 + i * 44;
            const held = s.held && label === 'policy check';
            const cls = ['map__stage', i >= s.reaches && 'map__stage--dim', held && 'map__approval']
              .filter(Boolean)
              .join(' ');
            return (
              <g className={cls} key={label}>
                <rect x={298} y={y - 5} width={6} height={6} />
                <text x={312} y={y} className="map__mono">
                  {label}
                </text>
              </g>
            );
          })}
          {s.held && (
            <text x={298} y={228} className="map__mono map__mono--sm map__approval-note">
              held · a person
            </text>
          )}

          <line x1={444} y1={50} x2={560} y2={50} className="map__rule" />
          <text x={444} y={92} className="map__label">
            CHECKS
          </text>
          <text x={444} y={114} className="map__mono map__mono--sm">
            {s.checks}
          </text>
          <text x={444} y={180} className="map__label">
            OUTCOME
          </text>
          <text x={444} y={207} className="map__value map__value--tone">
            {s.outcome}
          </text>

          <path
            d="M 500 290 V 330 Q 500 350 480 350 H 148 Q 128 350 128 330 V 290"
            className="map__return"
          />
          <text x={262} y={376} className="map__mono map__mono--sm map__mono--dim">
            replay · promote
          </text>

          <circle
            r={4}
            className="map__dot"
            style={{ offsetPath: `path("${s.path}")` } as CSSProperties}
          />
        </svg>

        {/* The text equivalent, and the layout below 1024. */}
        <ol className="map__stack">
          <li>
            <span className="map__label">INPUTS</span>
            <span className="map__mono">message · order</span>
          </li>
          <li>
            <span className="map__label">DECIDE</span>
            <span className="map__mono">intent · acme_damaged_order 1.0.0 · {s.decision}</span>
          </li>
          <li>
            <span className="map__label">ACT</span>
            <span className="map__mono">
              {ACT.slice(0, s.reaches).join(' · ')}
              {s.reaches < ACT.length ? ' · stopped' : ''}
            </span>
          </li>
          <li>
            <span className="map__label">PROVE</span>
            <span className="map__mono">
              {s.checks} · {s.outcome}
            </span>
          </li>
          <li className="map__stack-return">
            <span className="map__mono map__mono--dim">replay · promote</span>
          </li>
        </ol>
      </div>
    </div>
  );
}
