/**
 * The figures on the landing page. Every label is a string the repository
 * already contains, so a claim on this page can be checked by opening one file:
 *
 *   GATES   the thirteen numbered stages of `runTool` in packages/tools/src/pipeline.ts
 *   LADDER  every branch of `verifyRefund` in packages/tools/src/verify.ts
 *   FLOW    the same pipeline drawn end to end, including where it stops
 */

const GATES = [
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
] as const;

const EMPHASIS = new Set(['execute', 'verify']);

export function PipelineGates() {
  return (
    <ol className="gates">
      {GATES.map((label, i) => (
        <li className={`gates__row${EMPHASIS.has(label) ? ' gates__row--write' : ''}`} key={label}>
          <span className="gates__n mono">{String(i + 1).padStart(2, '0')}</span>
          <span className="mono">{label}</span>
        </li>
      ))}
    </ol>
  );
}

/** Reason strings are the ones `verifyRefund` returns, verbatim. */
const LADDER = [
  ['the refund id is not there', 'refund_not_found', false],
  ['pending', 'refund_pending', false],
  ['requires_action', 'refund_pending', false],
  ['failed', 'refund_failed', false],
  ['canceled', 'refund_canceled', false],
  ['succeeded, different amount', 'amount_mismatch', false],
  ['succeeded, different currency', 'currency_mismatch', false],
  ['succeeded, amount and currency match', 'verified', true],
] as const;

export function ReadBackLadder() {
  return (
    <table className="ladder">
      <thead>
        <tr>
          <th scope="col">What the read-back finds</th>
          <th scope="col">What Kora records</th>
          <th className="ladder__verdict" scope="col">
            Told the customer
          </th>
        </tr>
      </thead>
      <tbody>
        {LADDER.map(([observed, reason, ok]) => (
          <tr key={reason + observed}>
            <th className="mono" scope="row" style={{ fontWeight: 400 }}>
              {observed}
            </th>
            <td className="mono">{reason}</td>
            <td className={`ladder__verdict mono ${ok ? 'ladder__yes' : 'ladder__no'}`}>
              {ok ? 'refund confirmed' : 'not confirmed'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const BOX_W = 150;
const ROW1_Y = 60;
const ROW1_H = 64;
const ROW2_Y = 196;
const ROW2_H = 56;

const MAIN = [
  { x: 8, label: 'Request', sub: 'customer message' },
  { x: 190, label: 'Policy check', sub: 'config/policies' },
  { x: 372, label: 'Execute', sub: 'create_refund' },
  { x: 554, label: 'Read back', sub: 'getRefund' },
  { x: 736, label: 'Confirmed', sub: 'status succeeded' },
] as const;

const STOPS = [
  { x: 190, from: 265, label: 'No write', sub: 'the rule is named', edge: 'deny' },
  { x: 554, from: 629, label: 'A person', sub: 'never a check', edge: 'pending or differs' },
] as const;

/**
 * The one diagram on the page. It draws where a run stops as well as where it
 * finishes, because a straight line from request to confirmed would be the
 * claim this product exists to disprove.
 */
export function ActionToProofDiagram() {
  return (
    <div className="flow">
      <svg viewBox="0 0 900 272" xmlns="http://www.w3.org/2000/svg">
        <title>
          A request is checked against policy, executed, read back from Stripe, and only then called
          confirmed. A denial stops before the write. A read-back that disagrees goes to a person.
        </title>

        {MAIN.map((node, i) => {
          const end = i === MAIN.length - 1;
          return (
            <g key={node.label}>
              {i > 0 ? (
                <>
                  <line
                    className="flow__line"
                    x1={node.x - 32}
                    x2={node.x - 7}
                    y1={ROW1_Y + ROW1_H / 2}
                    y2={ROW1_Y + ROW1_H / 2}
                  />
                  <path
                    className="flow__arrow"
                    d={`M ${node.x - 7} ${ROW1_Y + ROW1_H / 2 - 4} L ${node.x} ${ROW1_Y + ROW1_H / 2} L ${node.x - 7} ${ROW1_Y + ROW1_H / 2 + 4} Z`}
                  />
                </>
              ) : null}
              <rect
                className={`flow__box${end ? ' flow__box--end' : ''}`}
                height={ROW1_H}
                rx="6"
                width={BOX_W}
                x={node.x}
                y={ROW1_Y}
              />
              <text
                className={`flow__label${end ? ' flow__label--on' : ''}`}
                x={node.x + 14}
                y={ROW1_Y + 28}
              >
                {node.label}
              </text>
              <text
                className={`flow__sub${end ? ' flow__sub--on' : ''}`}
                x={node.x + 14}
                y={ROW1_Y + 48}
              >
                {node.sub}
              </text>
            </g>
          );
        })}

        {STOPS.map((stop) => (
          <g key={stop.label}>
            <line
              className="flow__line flow__line--off"
              x1={stop.from}
              x2={stop.from}
              y1={ROW1_Y + ROW1_H}
              y2={ROW2_Y - 7}
            />
            <path
              className="flow__arrow flow__arrow--off"
              d={`M ${stop.from - 4} ${ROW2_Y - 7} L ${stop.from} ${ROW2_Y} L ${stop.from + 4} ${ROW2_Y - 7} Z`}
            />
            <text className="flow__edge" x={stop.from + 10} y={ROW2_Y - 30}>
              {stop.edge}
            </text>
            <rect
              className="flow__box flow__box--off"
              height={ROW2_H}
              rx="6"
              width={BOX_W}
              x={stop.x}
              y={ROW2_Y}
            />
            <text className="flow__label" x={stop.x + 14} y={ROW2_Y + 25}>
              {stop.label}
            </text>
            <text className="flow__sub" x={stop.x + 14} y={ROW2_Y + 43}>
              {stop.sub}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
