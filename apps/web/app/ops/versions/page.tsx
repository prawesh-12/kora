import { listVersions, previousActive, promotionHistory } from '@kora/db';
import { RollbackButton } from '@/components/ops/rollback-button';
import { tenantId } from '@/lib/ops/data';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = { promote: 'Promoted', rollback: 'Rolled back' };

export default async function VersionsPage() {
  const tenant = tenantId();
  const [versions, previous, history] = await Promise.all([
    listVersions(tenant),
    previousActive(tenant),
    promotionHistory(tenant, 20),
  ]);

  const active = versions.find((v) => v.status === 'active');

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="font-semibold text-2xl">Agent versions</h1>
        <p className="text-muted-foreground text-sm">
          A run pins its version when it starts, so a conversation already in flight finishes on the
          version it began with. Promotion and rollback never interrupt one.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-medium text-lg">Rollback</h2>
        {previous ? (
          <>
            <p className="text-muted-foreground text-sm">
              Active is v{active?.version ?? '?'}. Rollback has no gates and needs no redeploy.
            </p>
            <RollbackButton toVersion={previous.version} />
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            There is no archived version to roll back to yet.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-lg">Versions</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4 font-medium">Version</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Model</th>
                <th className="py-2 pr-4 font-medium">Activated</th>
                <th className="py-2 font-medium">Id</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 tabular-nums">v{v.version}</td>
                  <td className="py-2 pr-4">{v.status}</td>
                  <td className="py-2 pr-4">{v.model}</td>
                  <td className="py-2 pr-4">
                    {v.activatedAt ? v.activatedAt.toISOString().slice(0, 16) : '—'}
                  </td>
                  <td className="py-2 font-mono text-xs">{v.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-lg">History</h2>
        <p className="text-muted-foreground text-sm">
          Promotion needs a passing benchmark, a replay over at least 500 conversations with no
          verified-resolution regression, and every regression explicitly accepted with a note. Run
          it with <code>pnpm kora agent:promote</code>.
        </p>
        {history.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing has been promoted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">What</th>
                  <th className="py-2 pr-4 font-medium">Accepted regressions</th>
                  <th className="py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{h.createdAt.toISOString().slice(0, 16)}</td>
                    <td className="py-2 pr-4">{KIND_LABEL[h.kind] ?? h.kind}</td>
                    <td className="py-2 pr-4 tabular-nums">{h.acceptedRegressions.length}</td>
                    <td className="py-2">{h.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
