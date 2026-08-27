import { compareShadowDay, disagreementsByValue } from '@kora/db';
import { InsightCards, type InsightCardItem } from '@/components/ops/insight-cards';
import { tenantId } from '@/lib/ops/data';
import { NO_DATA, formatMoneyMinor, formatRate } from '@/lib/ops/format';

export const dynamic = 'force-dynamic';

const AGREEMENT_LABEL: Record<string, string> = {
  match: 'Same call',
  action_differs: 'Different action',
  amount_differs: 'Different amount',
  no_human_record: 'Nobody handled it',
};

export default async function ShadowPage() {
  const tenant = tenantId();
  const [byIntent, disagreements] = await Promise.all([
    compareShadowDay(tenant, new Date()),
    disagreementsByValue(tenant, 50),
  ]);

  const compared = byIntent.reduce((n, r) => n + r.n, 0);
  const matched = byIntent.reduce((n, r) => n + Math.round(r.agreementRate * r.n), 0);
  const skipped = disagreements.filter((d) => d.agreement === 'no_human_record').length;

  const cards: InsightCardItem[] = [
    {
      id: 'agreement',
      label: 'Agreement with the human',
      value: compared === 0 ? NO_DATA : formatRate(matched / compared),
      hint: `${compared} comparable run(s) today`,
    },
    {
      id: 'skipped',
      label: 'Skipped, no human record',
      value: String(skipped),
      hint: 'not counted as agreement',
    },
    {
      id: 'at-risk',
      label: 'Largest single disagreement',
      value: formatMoneyMinor(disagreements[0]?.valueAtRiskMinor ?? null, 'INR'),
      hint: 'ranked by what it would have cost',
    },
  ];

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="font-semibold text-2xl">Shadow mode</h1>
        <p className="text-muted-foreground text-sm">
          What the agent proposed against what a person actually did. Nothing here was executed: in
          shadow mode every write is simulated, which is what makes the human record ground truth
          rather than a second opinion.
        </p>
      </header>

      <InsightCards items={cards} />

      <section className="space-y-3">
        <h2 className="font-medium text-lg">Agreement by intent, today</h2>
        {byIntent.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No comparable runs today. A run counts here only once a person has resolved the same
            order.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4 font-medium">Intent</th>
                  <th className="py-2 pr-4 font-medium">Comparable runs</th>
                  <th className="py-2 font-medium">Agreement</th>
                </tr>
              </thead>
              <tbody>
                {byIntent.map((row) => (
                  <tr key={row.intent} className="border-b last:border-0">
                    <td className="py-2 pr-4">{row.intent}</td>
                    <td className="py-2 pr-4 tabular-nums">{row.n}</td>
                    <td className="py-2 tabular-nums">{formatRate(row.agreementRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-lg">Disagreements, most expensive first</h2>
        <p className="text-muted-foreground text-sm">
          The expensive ones are the ones worth reading.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4 font-medium">At risk</th>
                <th className="py-2 pr-4 font-medium">Agent proposed</th>
                <th className="py-2 pr-4 font-medium">Person did</th>
                <th className="py-2 pr-4 font-medium">Verdict</th>
                <th className="py-2 font-medium">Run</th>
              </tr>
            </thead>
            <tbody>
              {disagreements
                .filter((d) => d.agreement !== 'match')
                .map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 tabular-nums">
                      {formatMoneyMinor(d.valueAtRiskMinor, 'INR')}
                    </td>
                    <td className="py-2 pr-4">{d.proposedAction ?? 'nothing'}</td>
                    <td className="py-2 pr-4">{d.actualAction ?? 'nothing recorded'}</td>
                    <td className="py-2 pr-4">{AGREEMENT_LABEL[d.agreement] ?? d.agreement}</td>
                    <td className="py-2 font-mono text-xs">
                      <a className="underline" href={`/ops/conversations/${d.conversationId}`}>
                        {d.runId.slice(0, 12)}
                      </a>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
