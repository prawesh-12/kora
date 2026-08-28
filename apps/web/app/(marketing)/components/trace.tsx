import { at } from '@/components/marketing/beats';
import { Sequence } from '@/components/marketing/Sequence';
import { CheckGlyph } from './glyphs';

/**
 * The trace screen, rebuilt in HTML and played as a timed reveal.
 *
 * Server-rendered. `Sequence` owns only the controls, so nothing here hydrates
 * and the hero's paint is not waiting on it.
 *
 * The run is seeded Acme order 9833, an espresso machine at 899900 minor units
 * delivered three days ago. 899900 clears the 500000 threshold on
 * `high_value_needs_approval` in config/policies/acme-damaged-order.yaml, which
 * is why that rule returns `require_approval` and the write waits for a person.
 * Step kinds are `RunStepKind` values and the tools are the registered ones.
 *
 * The 1.0s pause between the hold at 1.85s and the approval at 2.85s is the
 * argument: everything before it is the agent proposing, everything after is a
 * person deciding. Everything else runs tight; that beat does not.
 */
export function TraceFragment() {
  return (
    <figure className="trace">
      <Sequence cycle={4.6} className="seq--onband">
        <div className="trace__card">
          {/* Neutral and wordless until the rule fires. The banner is the payoff. */}
          <div className="trace__verdict verdict">
            <div className="verdict__layer verdict__layer--held">
              <p className="trace__verdict-line">
                <span className="trace__verdict-tag">HELD</span>
                <span className="t-card trace__verdict-text">
                  Replacements at or above INR 5,000 need human approval
                </span>
              </p>
              <p className="trace__rule">
                rule high_value_needs_approval · policy acme_damaged_order 1.0.0
              </p>
            </div>
            <div className="verdict__layer verdict__layer--resolved">
              <p className="trace__verdict-line">
                <span className="trace__verdict-tag">RESOLVED</span>
                <span className="t-card trace__verdict-text">REP-0001 confirmed on order 9833</span>
              </p>
              <p className="trace__rule">outcome resolved_automatically · write_verified MET</p>
            </div>
          </div>

          <ol className="trace__steps">
            <li className="trace__step seq-step" style={at(0.15)}>
              <span className="trace__dot" aria-hidden="true" />
              <span className="trace__kind">intent</span>
              <span className="trace__name">DAMAGED_ORDER</span>
              <span className="trace__detail">confidence 0.94</span>
            </li>

            <li className="trace__step seq-step" style={at(0.45)}>
              <span className="trace__dot" aria-hidden="true" />
              <span className="trace__kind">tool</span>
              <span className="trace__name">get_order</span>
              <span className="trace__detail">9833 · delivered 3 days ago</span>
            </li>

            <li className="trace__step trace__step--open seq-step" style={at(0.75)}>
              <span className="trace__dot" aria-hidden="true" />
              <span className="trace__kind">tool</span>
              <span className="trace__name">create_replacement</span>
              <span className="trace__detail">write_high</span>

              <div className="trace__nested seq-step" style={at(0.95)}>
                <p className="trace__nested-head">policy · acme_damaged_order 1.0.0</p>
                <dl className="trace__facts">
                  <div className="seq-step" style={at(1.1)}>
                    <dt>daysSinceDelivery</dt>
                    <dd>3</dd>
                  </div>
                  <div className="seq-step" style={at(1.25)}>
                    <dt>amountMinor</dt>
                    <dd>899900</dd>
                  </div>
                  <div className="seq-step" style={at(1.4)}>
                    <dt>orderStatus</dt>
                    <dd>delivered</dd>
                  </div>
                  <div className="seq-step" style={at(1.55)}>
                    <dt>itemCategory</dt>
                    <dd>appliance</dd>
                  </div>
                </dl>
                <p className="trace__rule-row seq-step" style={at(1.85)}>
                  <span>high_value_needs_approval</span>
                  <span className="chip chip--amber">require_approval</span>
                </p>
              </div>

              <p className="trace__sub seq-step" style={at(2.85)}>
                <span className="trace__sub-label">approval</span>
                <span>granted · operator@acme.test</span>
              </p>
              <p className="trace__sub seq-step" style={at(3.1)}>
                <span className="trace__sub-label">executed</span>
                <span>REP-0001</span>
              </p>
            </li>

            <li className="trace__step seq-step" style={at(3.35)}>
              <span className="trace__dot" aria-hidden="true" />
              <span className="trace__kind">verify</span>
              <span className="trace__name">read back</span>
              <span className="trace__detail">REP-0001 · status created</span>
            </li>

            <li className="trace__step seq-step" style={at(3.85)}>
              <span className="trace__dot" aria-hidden="true" />
              <span className="trace__kind">response</span>
              <span className="trace__name">RESOLVED</span>
              <span className="trace__detail">resolved_automatically</span>
            </li>
          </ol>

          <p className="trace__readback seq-step" style={at(3.6)}>
            <span className="trace__readback-mark" aria-hidden="true">
              <CheckGlyph size={16} width={2.5} />
            </span>
            read back from Acme · REP-0001 confirmed on order 9833
          </p>
        </div>
      </Sequence>
      <figcaption className="t-meta trace__caption">
        Every run reconstructable, down to the rule that decided it.
      </figcaption>
    </figure>
  );
}
