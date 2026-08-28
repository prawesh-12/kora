import { CheckGlyph } from './glyphs';

/**
 * The trace screen, rebuilt in HTML.
 *
 * This is the one screen that carries the argument, so it has to show the
 * verdict first, the rule that produced it inside the card it applies to, and
 * the read-back that settled the run. The shipped trace screen does not lay it
 * out that way yet; see docs/decisions.md.
 */
export function TraceFragment() {
  return (
    <figure className="trace">
      <div className="trace__card">
        <div className="trace__verdict">
          <p className="trace__verdict-line">
            <span className="trace__verdict-tag">BLOCKED</span>
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
            <span className="trace__name">classify_intent</span>
            <span className="trace__detail">damaged_order · confidence 0.94</span>
          </li>
          <li className="trace__step">
            <span className="trace__dot" aria-hidden="true" />
            <span className="trace__name">get_order</span>
            <span className="trace__detail">ORD-8841 · delivered 4 days ago</span>
          </li>

          <li className="trace__step trace__step--open">
            <span className="trace__dot" aria-hidden="true" />
            <span className="trace__name">create_replacement</span>
            <span className="trace__detail">held for a person</span>

            <div className="trace__nested">
              <p className="trace__nested-head">policy check · acme_damaged_order 1.0.0</p>
              <dl className="trace__facts">
                <div>
                  <dt>daysSinceDelivery</dt>
                  <dd>4</dd>
                </div>
                <div>
                  <dt>amountMinor</dt>
                  <dd>349900</dd>
                </div>
                <div>
                  <dt>idempotencyKey</dt>
                  <dd>ord-8841-replacement</dd>
                </div>
              </dl>
              <p className="trace__rule-row">
                <span>high_value_needs_approval</span>
                <span className="chip chip--amber">require_approval</span>
              </p>
            </div>

            <p className="trace__sub">
              <span className="trace__sub-label">approved</span>
              <span>operator@acme.test · 2m 41s later</span>
            </p>
            <p className="trace__sub">
              <span className="trace__sub-label">executed</span>
              <span>REP-2931</span>
            </p>
          </li>

          <li className="trace__step">
            <span className="trace__dot" aria-hidden="true" />
            <span className="trace__name">reply_to_customer</span>
            <span className="trace__detail">grounded in the order record</span>
          </li>
        </ol>

        <p className="trace__readback">
          <span className="trace__readback-mark" aria-hidden="true">
            <CheckGlyph size={16} width={2.5} />
          </span>
          read back from Acme · REP-2931 confirmed
        </p>
      </div>
      <figcaption className="t-meta trace__caption">
        Every run reconstructable, down to the rule that decided it.
      </figcaption>
    </figure>
  );
}
