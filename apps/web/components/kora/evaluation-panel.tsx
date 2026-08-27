'use client';

import { Badge } from '@/components/ui/badge';
import type { EvaluationDto } from '@/lib/api/schemas';

const VERDICT_VARIANT = {
  MET: 'default',
  UNMET: 'destructive',
  CANNOT_ASSESS: 'outline',
} as const;

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
        <Badge variant={evaluation.verifiedResolution ? 'default' : 'destructive'}>
          {evaluation.verifiedResolution ? 'YES' : 'NO'}
        </Badge>
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
                <Badge className="ml-auto" variant={VERDICT_VARIANT[result.verdict]}>
                  {result.verdict}
                </Badge>
              </summary>
              <p className="px-4 pb-3 text-muted-foreground text-sm">{result.evidence}</p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
