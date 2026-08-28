import { CheckGlyph } from './glyphs';

/* ================================================== 3.6 the 2x2 grid ===== */

/** Top left. What the rule engine was handed and what it decided. */
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
      </dl>
      <p className="chip chip--signal">allow</p>
    </div>
  );
}

/** Top right. The signals intent detection put on the request. */
export function SignalChipsCell() {
  return (
    <div className="cell cell--cobalt">
      <ul className="cell__chips">
        <li className="cell__chip" style={{ marginLeft: 32 }}>
          damaged_order
        </li>
        <li className="cell__chip" style={{ marginLeft: 16 }}>
          within_window
        </li>
        <li className="cell__chip">under_threshold</li>
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

const PIPELINE = ['validated', 'permitted', 'policy allow', 'idempotency claimed', 'executed'];

/** Act. One pipeline, six gates, no second path. */
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
      <p className="bar bar--ink">create_replacement · REP-2931</p>
    </div>
  );
}

/** Verify. The claim, then the read-back that settles it. */
export function ChatFragment() {
  return (
    <div className="fig">
      <div className="chat__from-customer">
        <p className="t-meta bubble bubble--cobalt">My coffee machine arrived broken</p>
        <span className="chat__avatar" aria-hidden="true" />
      </div>
      <div className="chat__from-agent">
        <span className="chat__brace" aria-hidden="true">
          {'{ }'}
        </span>
        <p className="t-meta bubble bubble--paper">
          A replacement is on its way. I confirmed it on your order.
        </p>
      </div>
      <p className="bar bar--signal">read back from Acme · confirmed</p>
      <ul className="checklist">
        <li>
          <span className="checklist__mark" aria-hidden="true">
            <CheckGlyph size={16} width={2.5} />
          </span>
          <span className="t-meta">replacement REP-2931 exists</span>
        </li>
        <li>
          <span className="checklist__mark" aria-hidden="true">
            <CheckGlyph size={16} width={2.5} />
          </span>
          <span className="t-meta">order status is replacement_created</span>
        </li>
      </ul>
    </div>
  );
}

/**
 * Evaluate. The nine checks the evaluator actually runs, in the order it runs
 * them. The build note asked for seven; the code has nine, and this page is
 * about not saying a thing happened when it did not.
 */
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
        {CHECKS.map(([id, passed]) => (
          <li className="checks__row" key={id}>
            <span className="checks__id">{id}</span>
            <span className={`chip ${passed ? 'chip--signal' : 'chip--ink'}`}>
              {passed ? 'pass' : 'fail'}
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

/** Improve. Two configurations, one replay, the differences between them. */
const REPLAY = [
  ['Verified resolution', '71.2', '76.4', '+5.2', true],
  ['Policy compliance', '96.1', '98.0', '+1.9', true],
  ['Escalation', '24.8', '21.3', '-3.5', true],
  ['Grounding', '93.4', '92.7', '-0.7', false],
] as const;

export function ReplayFragment() {
  return (
    <div className="fig">
      <table className="replay">
        <thead>
          <tr>
            <th scope="col" className="replay__metric">
              <span className="sr-only">Metric</span>
            </th>
            <th scope="col">v3</th>
            <th scope="col">v4</th>
            <th scope="col">delta</th>
          </tr>
        </thead>
        <tbody>
          {REPLAY.map(([metric, v3, v4, delta, better]) => (
            <tr key={metric}>
              <th scope="row" className="replay__metric">
                {metric}
              </th>
              <td>{v3}</td>
              <td>{v4}</td>
              <td className={better ? 'replay__delta--up' : undefined}>{delta}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="chip chip--rust">6 regressions</p>
    </div>
  );
}

/* ============================================== 3.8 integration visuals == */

export function ConfigBlock() {
  return (
    <pre className="code">
      <code>
        <span className="code__key">mcpServers</span>
        <span className="code__punct">: {'{'}</span>
        {'\n  '}
        <span className="code__key">kora</span>
        <span className="code__punct">: {'{'}</span>
        {'\n    '}
        <span className="code__key">type</span>
        <span className="code__punct">: </span>
        <span className="code__string">"streamable-http"</span>
        <span className="code__punct">,</span>
        {'\n    '}
        <span className="code__key">url</span>
        <span className="code__punct">: </span>
        <span className="code__string">"https://api.kora.example/mcp"</span>
        {'\n  '}
        <span className="code__punct">{'}'}</span>
        {'\n'}
        <span className="code__punct">{'}'}</span>
      </code>
    </pre>
  );
}

const ROUTES = [
  ['GET', 'var(--cobalt)', 'var(--paper)', '/v1/conversations/{id}/trace'],
  ['POST', 'var(--signal)', 'var(--paper)', '/v1/conversations/{id}/messages'],
  ['POST', 'var(--amber)', 'var(--ink)', '/v1/approvals/{id}/decision'],
  ['GET', 'var(--ink)', 'var(--paper)', '/v1/metrics'],
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
