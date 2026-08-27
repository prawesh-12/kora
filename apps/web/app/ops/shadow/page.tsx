import { compareShadowDay, disagreementsByValue } from '@kora/db';
import { Handshake } from 'lucide-react';
import { StatBar, Tile } from '@/components/kora/stat';
import { EmptyState } from '@/components/kora/states';
import { tenantId } from '@/lib/ops/data';
import { EMPTY, NO_DATA, formatMoneyMinor, formatRate, truncateId } from '@/lib/ops/format';

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

  // A run with no human record is not a disagreement, it is a run nobody else
  // handled. Ranking it by value would fill the table with zeroes.
  const real = disagreements.filter(
    (d) => d.agreement !== 'match' && d.agreement !== 'no_human_record',
  );

  return (
    <main className="flex flex-col gap-8 p-8">
      <header className="space-y-1">
        <h1 className="font-semibold text-xl tracking-tight">Shadow mode</h1>
        <p className="text-muted-foreground text-sm">
          What the agent proposed against what a person actually did. Nothing here was executed: in
          shadow mode every write is simulated, which is what makes the human record ground truth
          rather than a second opinion.
        </p>
      </header>

      <StatBar columns={3}>
        <Tile
          label="Agreement with the human"
          sub={`${skipped} skipped, no human record`}
          value={compared === 0 ? NO_DATA : formatRate(matched / compared)}
        />
        <Tile
          label="Largest single disagreement"
          sub="ranked by what it would have cost"
          tone={real.length === 0 ? 'default' : 'warn'}
          value={
            real.length === 0 ? EMPTY : formatMoneyMinor(real[0]?.valueAtRiskMinor ?? null, 'INR')
          }
        />
        <Tile
          label="Comparable runs"
          sub="a person resolved the same order"
          value={compared.toLocaleString()}
        />
      </StatBar>

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
        {real.length === 0 ? (
          <EmptyState
            description={
              compared === 0
                ? 'A run appears here once a person has resolved the same order and the agent proposed something different.'
                : `No disagreements today. All ${compared} comparable runs matched what the person did.`
            }
            icon={Handshake}
            title="Nothing to review"
          />
        ) : (
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
                {real.map((d) => (
                  <tr className="h-10 border-b last:border-0 hover:bg-muted/50" key={d.id}>
                    <td className="py-2 pr-4 tabular-nums">
                      {formatMoneyMinor(d.valueAtRiskMinor, 'INR')}
                    </td>
                    <td className="py-2 pr-4">{d.proposedAction ?? EMPTY}</td>
                    <td className="py-2 pr-4">{d.actualAction ?? EMPTY}</td>
                    <td className="py-2 pr-4">{AGREEMENT_LABEL[d.agreement] ?? d.agreement}</td>
                    <td className="py-2 font-mono text-xs">
                      <a
                        className="underline underline-offset-4"
                        href={`/ops/conversations/${d.conversationId}`}
                        title={d.runId}
                      >
                        {truncateId(d.runId)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
