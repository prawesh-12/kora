import { listVersions, previousActive, promotionHistory } from '@kora/db';
import { CopyId } from '@/components/kora/copy-id';
import { HeroStat } from '@/components/kora/stat';
import { StatusPill, type Status } from '@/components/kora/status-pill';
import { RollbackButton } from '@/components/ops/rollback-button';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { tenantId } from '@/lib/ops/data';
import { EMPTY, formatAbsolute, formatRelative } from '@/lib/ops/format';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = { promote: 'Promoted', rollback: 'Rolled back' };

const VERSION_STATUS: Record<string, Status> = {
  active: 'ok',
  archived: 'muted',
  draft: 'info',
};

const PROMOTION_RULES =
  'Promotion needs a passing benchmark, a replay over at least 500 conversations with no verified-resolution regression, and every regression accepted with a note. Run it with pnpm kora agent:promote.';

export default async function VersionsPage() {
  const tenant = tenantId();
  const [versions, previous, history] = await Promise.all([
    listVersions(tenant),
    previousActive(tenant),
    promotionHistory(tenant, 20),
  ]);

  const active = versions.find((v) => v.status === 'active');

  return (
    <div className="flex flex-col gap-8 p-8">
      <header className="space-y-1">
        <h1 className="font-semibold text-xl tracking-tight">Agent versions</h1>
        <p className="text-muted-foreground text-sm">
          A run pins its version when it starts, so a conversation already in flight finishes on the
          version it began with. Promotion and rollback never interrupt one.
        </p>
      </header>

      <HeroStat
        aside={
          active ? (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-muted-foreground">{active.model}</span>
              <CopyId id={active.id} />
            </div>
          ) : null
        }
        context={
          active?.activatedAt
            ? `activated ${formatRelative(active.activatedAt)}`
            : 'nothing is active'
        }
        label="Live version"
        tone={active ? 'ok' : 'default'}
        value={active ? `v${active.version}` : EMPTY}
      />

      <section className="space-y-3">
        <h2 className="font-medium text-lg">Change the live version</h2>
        <div className="flex flex-wrap items-start gap-3">
          <RollbackButton toVersion={previous?.version ?? null} />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block">
                <Button disabled size="sm" variant="outline">
                  Promote a new version
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{PROMOTION_RULES}</TooltipContent>
          </Tooltip>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-lg">Versions</h2>
        <div className="overflow-x-auto rounded-[10px] border">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr className="h-10">
                <th className="px-3 font-medium">Version</th>
                <th className="px-3 font-medium">Status</th>
                <th className="px-3 font-medium">Model</th>
                <th className="px-3 font-medium">Activated</th>
                <th className="px-3 font-medium">Id</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr className="h-10 border-b last:border-0 hover:bg-muted/50" key={v.id}>
                  <td className="px-3 tabular-nums">v{v.version}</td>
                  <td className="px-3">
                    <StatusPill status={VERSION_STATUS[v.status] ?? 'muted'}>{v.status}</StatusPill>
                  </td>
                  <td className="px-3">{v.model}</td>
                  <td className="px-3" title={formatAbsolute(v.activatedAt)}>
                    {formatRelative(v.activatedAt)}
                  </td>
                  <td className="px-3">
                    <CopyId id={v.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {history.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-medium text-lg">History</h2>
          <div className="overflow-x-auto rounded-[10px] border">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr className="h-10">
                  <th className="px-3 font-medium">When</th>
                  <th className="px-3 font-medium">What</th>
                  <th className="px-3 font-medium">Accepted regressions</th>
                  <th className="px-3 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr className="h-10 border-b last:border-0" key={h.id}>
                    <td className="px-3" title={formatAbsolute(h.createdAt)}>
                      {formatRelative(h.createdAt)}
                    </td>
                    <td className="px-3">{KIND_LABEL[h.kind] ?? h.kind}</td>
                    <td className="px-3 tabular-nums">{h.acceptedRegressions.length}</td>
                    <td className="px-3">{h.note ?? EMPTY}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
