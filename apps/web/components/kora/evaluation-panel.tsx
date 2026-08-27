'use client';

import { StatusPill, type Status } from '@/components/kora/status-pill';
import { humanizeEnum } from '@/lib/ops/format';
import type { EvaluationDto } from '@/lib/api/schemas';

/** Grey is missing data, never a soft fail. A check that could not be assessed
 *  is missing data. */
const VERDICT_STATUS: Record<string, Status> = {
  MET: 'ok',
  UNMET: 'danger',
  CANNOT_ASSESS: 'muted',
};

export function EvaluationPanel({
  evaluation,
  runInProgress,
}: {
  evaluation: EvaluationDto | null;
  runInProgress: boolean;
}) {
  if (!evaluation) {
    return (
      <div data-testid="evaluation-pending" className="rounded-lg border bg-card p-4 text-sm">
        <p className="font-medium">Evaluation</p>
        <p className="text-muted-foreground">
          {runInProgress ? 'The run has not finished yet.' : 'Evaluating.'}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="evaluation-panel" className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <span className="font-medium font-mono text-xs uppercase tracking-wide">
          Verified resolution
        </span>
        <StatusPill status={evaluation.verifiedResolution ? 'ok' : 'danger'}>
          {evaluation.verifiedResolution ? 'yes' : 'no'}
        </StatusPill>
      </div>
      <ul className="divide-y">
        {evaluation.results.map((result) => (
          <li key={result.checkId}>
            <details data-testid={`evaluation-check-${result.checkId}`}>
              <summary className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm">
                <span className="font-mono">{result.checkId}</span>
                {result.critical ? (
                  <span className="text-muted-foreground text-xs">critical</span>
                ) : null}
                <StatusPill className="ml-auto" status={VERDICT_STATUS[result.verdict] ?? 'muted'}>
                  {humanizeEnum(result.verdict)}
                </StatusPill>
              </summary>
              <p className="px-4 pb-3 text-muted-foreground text-sm">{result.evidence}</p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
