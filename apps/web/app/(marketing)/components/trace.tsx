import { CheckGlyph } from './glyphs';

/**
 * The trace screen, rebuilt in HTML.
 *
 * The run is a real one: seeded Acme order 9833, an espresso machine at 899900
 * minor units delivered three days ago. 899900 is over the 500000 threshold on
 * `high_value_needs_approval` in config/policies/acme-damaged-order.yaml, so
 * that rule returns `require_approval` and the write waits for a person. Step
 * kinds are `RunStepKind` values and the tool names are the registered ones.
 *
 * The shipped trace screen does not lead with the verdict yet; see
 * docs/decisions.md.
 */
export function TraceFragment() {
  return (
    <figure className="trace">
      <div className="trace__card">
        <div className="trace__verdict">
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

        <ol className="trace__steps">
          <li className="trace__step">
            <span className="trace__dot" aria-hidden="true" />
            <span className="trace__kind">intent</span>
            <span className="trace__name">DAMAGED_ORDER</span>
            <span className="trace__detail">confidence 0.94</span>
          </li>
          <li className="trace__step">
            <span className="trace__dot" aria-hidden="true" />
            <span className="trace__kind">tool</span>
            <span className="trace__name">get_order</span>
            <span className="trace__detail">9833 · delivered 3 days ago</span>
          </li>

          <li className="trace__step trace__step--open">
            <span className="trace__dot" aria-hidden="true" />
            <span className="trace__kind">tool</span>
            <span className="trace__name">create_replacement</span>
            <span className="trace__detail">write_high</span>

            <div className="trace__nested">
              <p className="trace__nested-head">policy · acme_damaged_order 1.0.0</p>
              <dl className="trace__facts">
                <div>
                  <dt>daysSinceDelivery</dt>
                  <dd>3</dd>
                </div>
                <div>
                  <dt>amountMinor</dt>
                  <dd>899900</dd>
                </div>
                <div>
                  <dt>orderStatus</dt>
                  <dd>delivered</dd>
                </div>
                <div>
                  <dt>itemCategory</dt>
                  <dd>appliance</dd>
                </div>
              </dl>
              <p className="trace__rule-row">
                <span>high_value_needs_approval</span>
                <span className="chip chip--amber">require_approval</span>
              </p>
            </div>

            <p className="trace__sub">
              <span className="trace__sub-label">approval</span>
              <span>granted · operator@acme.test</span>
            </p>
            <p className="trace__sub">
              <span className="trace__sub-label">executed</span>
              <span>REP-0001</span>
            </p>
          </li>

          <li className="trace__step">
            <span className="trace__dot" aria-hidden="true" />
            <span className="trace__kind">verify</span>
            <span className="trace__name">read back</span>
            <span className="trace__detail">REP-0001 · status created</span>
          </li>
          <li className="trace__step">
            <span className="trace__dot" aria-hidden="true" />
            <span className="trace__kind">response</span>
            <span className="trace__name">RESOLVED</span>
            <span className="trace__detail">resolved_automatically</span>
          </li>
        </ol>

        <p className="trace__readback">
          <span className="trace__readback-mark" aria-hidden="true">
            <CheckGlyph size={16} width={2.5} />
          </span>
          read back from Acme · REP-0001 confirmed on order 9833
        </p>
      </div>
      <figcaption className="t-meta trace__caption">
        Every run reconstructable, down to the rule that decided it.
      </figcaption>
    </figure>
  );
}
