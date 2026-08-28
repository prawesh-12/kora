import { CheckGlyph } from './glyphs';

/**
 * Every identifier here is one the repository actually uses.
 *
 * Order 9833 is a seeded Acme order: an espresso machine at 899900 minor units,
 * delivered three days ago. That is over the 500000 threshold in
 * `config/policies/acme-damaged-order.yaml`, which is why the rule that fires on
 * it is `high_value_needs_approval`. Order 9832 sits at 349900 and clears
 * `standard_replacement` instead. Getting these the wrong way round is the kind
 * of thing this page exists to argue against.
 */

/* ================================================== 3.6 the 2x2 grid ===== */

/** Top left. The facts the rule engine was handed, and what it returned. */
export function PolicyCheckCell() {
  return (
    <div className="cell cell--warm">
      <p className="cell__action">create_replacement</p>
      <dl className="cell__facts">
        <div>
          <dt>daysSinceDelivery</dt>
          <dd>4</dd>
        </div>
        <div>
          <dt>amountMinor</dt>
          <dd>349900</dd>
        </div>
        <div>
          <dt>orderStatus</dt>
          <dd>delivered</dd>
        </div>
      </dl>
      <p className="chip chip--signal">allow</p>
    </div>
  );
}

/** Top right. The rules that were evaluated to get there. */
export function SignalChipsCell() {
  return (
    <div className="cell cell--cobalt">
      <ul className="cell__chips">
        <li className="cell__chip" style={{ marginLeft: 28 }}>
          outside_return_window
        </li>
        <li className="cell__chip" style={{ marginLeft: 14 }}>
          already_replaced
        </li>
        <li className="cell__chip">standard_replacement</li>
      </ul>
    </div>
  );
}

/** Bottom left. A finished run's score. */
export function ScoreCell() {
  const r = 88;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="cell cell--warm cell--centre-piece">
      <div className="donut">
        <svg width="200" height="200" viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r={r} fill="none" stroke="var(--paper)" strokeWidth="24" />
          <circle
            cx="100"
            cy="100"
            r={r}
            fill="none"
            stroke="var(--signal)"
            strokeWidth="24"
            strokeDasharray={`${circumference * 0.94} ${circumference}`}
            transform="rotate(-90 100 100)"
          />
        </svg>
        <span className="donut__value">94</span>
      </div>
    </div>
  );
}

/** Bottom right. Read back, and it agreed. */
export function VerifiedCell() {
  return (
    <div className="cell cell--signal cell--centre-piece">
      <span className="big-check">
        <svg width="200" height="200" viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r="100" fill="var(--paper)" />
          <path
            d="M55 102 L86 133 L146 68"
            fill="none"
            stroke="var(--signal)"
            strokeWidth="6"
            strokeLinecap="square"
          />
        </svg>
      </span>
    </div>
  );
}

/* ================================================ 3.7 pillar fragments === */

/** The gates `packages/tools/src/pipeline.ts` runs, in the order it runs them. */
const PIPELINE = [
  'input validated',
  'permission checked',
  'policy evaluated',
  'breaker closed',
  'idempotency claimed',
  'executed',
];

export function PipelineFragment() {
  return (
    <div className="fig">
      <ol className="pipe">
        {PIPELINE.map((label) => (
          <li className="pipe__row" key={label}>
            <span className="pipe__node" aria-hidden="true">
              <CheckGlyph size={16} width={2.5} />
            </span>
            <span className="t-meta pipe__label">{label}</span>
          </li>
        ))}
      </ol>
      <p className="bar bar--ink">create_replacement · REP-0001</p>
    </div>
  );
}

/** Verify. The claim, then the read-back that settles it. */
export function ChatFragment() {
  return (
    <div className="fig">
      <div className="chat__from-customer">
        <p className="t-meta bubble bubble--cobalt">My espresso machine arrived broken</p>
      </div>
      <div className="chat__from-agent">
        <span className="chat__brace" aria-hidden="true">
          {'{ }'}
        </span>
        <p className="t-meta bubble bubble--paper">
          A replacement is on its way. I confirmed it on order 9833.
        </p>
      </div>
      <p className="bar bar--signal">read back from Acme · verified</p>
      <ul className="checklist">
        <li>
          <span className="checklist__mark" aria-hidden="true">
            <CheckGlyph size={16} width={2.5} />
          </span>
          <span className="t-meta">REP-0001 exists and is for order 9833</span>
        </li>
        <li>
          <span className="checklist__mark" aria-hidden="true">
            <CheckGlyph size={16} width={2.5} />
          </span>
          <span className="t-meta">status is created, and it is the only one</span>
        </li>
      </ul>
    </div>
  );
}

/** The nine checks in `CHECKS`, in the order that array declares them. */
const CHECKS = [
  ['outcome_achieved', true],
  ['policy_compliance', true],
  ['tool_correctness', true],
  ['write_verified', true],
  ['idempotency_clean', true],
  ['escalation_correct', true],
  ['response_grounded', true],
  ['arguments_valid', true],
  ['latency_budget', false],
] as const;

export function ChecksFragment() {
  return (
    <div className="fig">
      <ul className="checks">
        {CHECKS.map(([id, met]) => (
          <li className="checks__row" key={id}>
            <span className="checks__id">{id}</span>
            <span className={`chip ${met ? 'chip--signal' : 'chip--ink'}`}>
              {met ? 'MET' : 'UNMET'}
            </span>
          </li>
        ))}
      </ul>
      <p className="bar bar--ink bar--split">
        <span>VERIFIED RESOLUTION</span>
        <span>YES</span>
      </p>
    </div>
  );
}

/**
 * Improve. The aggregate `replay()` returns, with its own column names.
 *
 * `renderReplay` prints regressions above the table on purpose, so a reviewer
 * cannot read the headline and stop. This keeps that order.
 */
const REPLAY = [
  ['verifiedResolution', '71.2%', '76.4%', '+5.2', true],
  ['policyCompliance', '96.1%', '98.0%', '+1.9', true],
  ['escalationRate', '24.8%', '21.3%', '-3.5', true],
  ['meanLatencyMs', '4182', '4410', '+228', false],
] as const;

export function ReplayFragment() {
  return (
    <div className="fig">
      <p className="chip chip--rust replay__regressions">6 regressions — read these first</p>
      <table className="replay">
        <thead>
          <tr>
            <th scope="col" className="replay__metric">
              metric
            </th>
            <th scope="col">from</th>
            <th scope="col">against</th>
            <th scope="col">delta</th>
          </tr>
        </thead>
        <tbody>
          {REPLAY.map(([metric, from, against, delta, better]) => (
            <tr key={metric}>
              <th scope="row" className="replay__metric">
                {metric}
              </th>
              <td>{from}</td>
              <td>{against}</td>
              <td className={better ? 'replay__delta--up' : undefined}>{delta}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================================== 3.8 integration visuals == */

/** A trimmed response from GET /api/conversations/{id}/trace. */
export function TraceResponseBlock() {
  return (
    <pre className="code">
      <code>
        <span className="code__punct">{'{'}</span>
        {'\n  '}
        <span className="code__key">"run"</span>
        <span className="code__punct">: {'{'}</span>
        {'\n    '}
        <span className="code__key">"intent"</span>
        <span className="code__punct">: </span>
        <span className="code__string">"DAMAGED_ORDER"</span>
        <span className="code__punct">,</span>
        {'\n    '}
        <span className="code__key">"intentConfidence"</span>
        <span className="code__punct">: 0.94,</span>
        {'\n    '}
        <span className="code__key">"finalState"</span>
        <span className="code__punct">: </span>
        <span className="code__string">"RESOLVED"</span>
        <span className="code__punct">,</span>
        {'\n    '}
        <span className="code__key">"outcome"</span>
        <span className="code__punct">: </span>
        <span className="code__string">"resolved_automatically"</span>
        {'\n  '}
        <span className="code__punct">{'}'}</span>
        {'\n'}
        <span className="code__punct">{'}'}</span>
      </code>
    </pre>
  );
}

/** Four routes that exist under apps/web/app/api. */
const ROUTES = [
  ['GET', 'var(--cobalt)', 'var(--paper)', '/api/conversations/{id}/trace'],
  ['POST', 'var(--signal)', 'var(--ink)', '/api/chat/{conversationId}'],
  ['POST', 'var(--amber)', 'var(--ink)', '/api/approvals/{id}/decision'],
  ['GET', 'var(--ink)', 'var(--paper)', '/api/metrics'],
] as const;

export function RouteRows() {
  return (
    <ul className="routes">
      {ROUTES.map(([method, fill, ink, path]) => (
        <li className="routes__row" key={path}>
          <span className="routes__method" style={{ background: fill, color: ink }}>
            {method}
          </span>
          <span className="routes__path">{path}</span>
        </li>
      ))}
    </ul>
  );
}
