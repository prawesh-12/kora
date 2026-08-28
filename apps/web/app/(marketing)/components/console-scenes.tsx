import type { CSSProperties } from 'react';
import { at } from '@/components/marketing/beats';
import { Sequence } from '@/components/marketing/Sequence';

/**
 * Four fragments of the operator console, rebuilt in HTML and played in time.
 *
 * All server-rendered: `Sequence` owns the controls, CSS owns the beats.
 *
 * The identifiers are the code's own. Failure codes come from `FAILURE_CODES`,
 * their colour from `FAILURE_SEVERITY`, the metric labels from the `Metrics`
 * interface, and `get_order / upstream_4xx` is the exact string the failure
 * breakdown builds. The counts and rates are seeded demo figures, not measured
 * performance; see docs/decisions.md.
 */

/* ---------------------------------------------------- 1. something is wrong */

export function OverviewScene() {
  return (
    <Sequence cycle={4.2}>
      <div className="con">
        <div className="con__hero seq-step" style={at(0.2)}>
          <p className="con__label">VERIFIED RESOLUTION RATE</p>
          <p className="con__hero-value">30.4%</p>
          <p className="con__meta">4,085 evaluated · 310 pending</p>
        </div>
        <div className="con__tiles">
          <div className="con__tile seq-step" style={at(0.8)}>
            <p className="con__label">TOTAL RUNS</p>
            <p className="con__tile-value">4,843</p>
          </div>
          <div className="con__tile seq-step" style={at(1.1)}>
            <p className="con__label">ELIGIBLE RUNS</p>
            <p className="con__tile-value">4,395</p>
          </div>
          <div className="con__tile con__tile--marked seq-step" style={at(1.4)}>
            <p className="con__label">ESCALATION RATE</p>
            <p className="con__tile-value con__tile-value--alarm">20.2%</p>
            <span className="con__mark seq-fade" style={at(2.2)} aria-hidden="true" />
          </div>
        </div>
      </div>
    </Sequence>
  );
}

/* --------------------------------------------------------- 2. which failure */

/**
 * Length is the count, colour is `FAILURE_SEVERITY`. Critical means the system
 * did something it was not allowed to do or said something untrue, which is why
 * two of the shortest bars are the only coloured ones.
 */
const FAILURES = [
  ['TOOL_EXECUTION_FAILURE', 622, 'normal', 'get_order / upstream_4xx'],
  ['INTENT_FAILURE', 284, 'low', 'out of scope'],
  ['OUTCOME_FAILURE', 273, 'critical', 'damaged order'],
  ['ESCALATION_FAILURE', 232, 'normal', 'damaged order'],
  ['TOOL_SELECTION_FAILURE', 128, 'normal', 'damaged order'],
  ['KNOWLEDGE_FAILURE', 64, 'normal', 'damaged order'],
  ['RETRIEVAL_FAILURE', 15, 'normal', 'damaged order'],
  ['POLICY_FAILURE', 2, 'critical', 'missing order facts'],
] as const;

const MAX = 622;

export function FailuresScene() {
  return (
    <Sequence cycle={4}>
      <div className="con">
        <ul className="fail">
          {FAILURES.map(([code, count, severity, why], i) => (
            <li className={`fail__row${i === 0 ? ' fail__row--picked' : ''}`} key={code}>
              <span className="fail__count">{count}</span>
              <span className="fail__code">{code}</span>
              <span className="fail__track">
                <span
                  className={`fail__bar fail__bar--${severity} seq-grow`}
                  style={{ ...at(0.2 + i * 0.08), '--to': count / MAX } as CSSProperties}
                />
              </span>
              <span className="fail__why">
                {i === 0 ? (
                  <span className="seq-fade" style={at(2.1)}>
                    {why}
                  </span>
                ) : (
                  why
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Sequence>
  );
}

/* --------------------------------------------------- 3. which conversations */

const ROWS = [
  ['22h 4m ago', 'damaged order', 'needs human', 'fail', '39ms', 'open'],
  ['22h 4m ago', 'damaged order', 'needs human', 'fail', '31ms', 'open'],
  ['22h 45m ago', 'damaged order', 'needs human', 'fail', '49ms', 'open'],
  ['22h 45m ago', 'damaged order', 'needs human', 'fail', '64ms', 'open'],
  ['23h 1m ago', 'damaged order', 'needs human', 'fail', '52ms', 'open'],
] as const;

export function DrillScene() {
  return (
    <Sequence cycle={4.6}>
      <div className="con drill">
        <div className="drill__before">
          <span className="fail__count">622</span>
          <span className="fail__code">TOOL_EXECUTION_FAILURE</span>
          <span className="fail__track">
            <span className="fail__bar fail__bar--normal drill__full" />
          </span>
          <span className="drill__cursor" style={at(0.3)}>
            <svg width="22" height="26" viewBox="0 0 22 26" aria-hidden="true">
              <path
                d="M2 1 L2 20 L7 15.5 L10.5 24 L14 22.5 L10.5 14.5 L17 14 Z"
                fill="var(--ink)"
                stroke="var(--paper)"
                strokeWidth="1.5"
              />
            </svg>
          </span>
        </div>

        <div className="drill__after">
          <div className="drill__filters seq-step" style={at(1.8)}>
            <span className="drill__chip">primary failure is TOOL_EXECUTION_FAILURE</span>
            <span className="drill__count">622 runs</span>
          </div>
          <table className="rows">
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col">Intent</th>
                <th scope="col">State</th>
                <th scope="col">Verified</th>
                <th scope="col">Duration</th>
                <th scope="col">Escalated</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([started, intent, state, verified, duration, esc], i) => (
                <tr className="seq-step" style={at(2.2 + i * 0.14)} key={`${started}-${duration}`}>
                  <td className="rows__mono">{started}</td>
                  <td>{intent}</td>
                  <td>
                    <span className="rows__state">{state}</span>
                  </td>
                  <td>
                    <span className="rows__verdict">{verified}</span>
                  </td>
                  <td className="rows__mono">{duration}</td>
                  <td>{esc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Sequence>
  );
}

/* ------------------------------------------------ 4. exactly where it broke */

export function BrokenTraceScene() {
  return (
    <Sequence cycle={5.2}>
      <div className="trace__card">
        <div className="trace__verdict verdict verdict--fail">
          <div className="verdict__layer verdict__layer--neutral">
            <p className="trace__verdict-line">
              <span className="trace__verdict-tag">RUNNING</span>
              <span className="t-card trace__verdict-text">get_order on order 9833</span>
            </p>
            <p className="trace__rule">reading the order record</p>
          </div>
          <div className="verdict__layer verdict__layer--failed">
            <p className="trace__verdict-line">
              <span className="trace__verdict-tag">FAILED</span>
              <span className="t-card trace__verdict-text">
                Acme returned 4xx, so no fact was ever read
              </span>
            </p>
            <p className="trace__rule">TOOL_EXECUTION_FAILURE · get_order / upstream_4xx</p>
          </div>
        </div>

        <ol className="trace__steps">
          <li className="trace__step seq-step" style={at(0.3)}>
            <span className="trace__dot" aria-hidden="true" />
            <span className="trace__kind">intent</span>
            <span className="trace__name">DAMAGED_ORDER</span>
            <span className="trace__detail">confidence 0.94</span>
          </li>
          <li className="trace__step seq-step" style={at(1.0)}>
            <span className="trace__dot" aria-hidden="true" />
            <span className="trace__kind">tool</span>
            <span className="trace__name">get_order</span>
            <span className="trace__detail">attempt 1 · UPSTREAM_4XX</span>
          </li>
          <li className="trace__step seq-step" style={at(1.6)}>
            <span className="trace__dot" aria-hidden="true" />
            <span className="trace__kind">tool</span>
            <span className="trace__name">get_order</span>
            <span className="trace__detail">attempt 2 of 2 · UPSTREAM_4XX</span>
          </li>
          <li className="trace__step seq-step" style={at(3.0)}>
            <span className="trace__dot" aria-hidden="true" />
            <span className="trace__kind">tool</span>
            <span className="trace__name">escalate_to_human</span>
            <span className="trace__detail">TOOL_FAILED</span>
          </li>
          <li className="trace__step seq-step" style={at(3.6)}>
            <span className="trace__dot" aria-hidden="true" />
            <span className="trace__kind">state</span>
            <span className="trace__name">NEEDS_HUMAN</span>
            <span className="trace__detail">escalated · nothing was written</span>
          </li>
        </ol>
      </div>
    </Sequence>
  );
}
