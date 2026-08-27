import type { AssembledTrace } from '../deps.js';

/**
 * Fixed budget so a long conversation cannot score better for being long. The
 * judge sees the same shape every time, in the same order.
 */
const MAX_CHARS = 6000;

// A trace assembled from a crashed run can be missing fields. The renderer must
// never throw: a judge that cannot run is better than an evaluation that cannot.
function truncate(text: string | null | undefined, limit: number): string {
  if (!text) return '';
  return text.length <= limit ? text : `${text.slice(0, limit)}… (truncated)`;
}

/**
 * Renders a trace for the judge.
 *
 * Deliberately excludes the deterministic check results. A judge that can see
 * them anchors on them and stops being an independent signal, which is the only
 * thing it is for.
 */
export function renderTraceForJudge(trace: AssembledTrace): string {
  const parts: string[] = [];

  parts.push(
    `<intent>\n${trace.run.intent ?? 'none'} (confidence ${trace.run.intentConfidence ?? 'n/a'})\n</intent>`,
  );

  parts.push(
    `<conversation>\n${trace.conversation.messages
      .map((m) => `${m.role}: ${truncate(m.content, 800)}`)
      .join('\n')}\n</conversation>`,
  );

  const retrieved = trace.retrievals.flatMap((r) => r.chunks);
  parts.push(
    `<retrieved_knowledge>\n${
      retrieved.length === 0
        ? 'nothing was retrieved'
        : retrieved.map((c) => `[${c.headingPath}] ${truncate(c.content, 500)}`).join('\n\n')
    }\n</retrieved_knowledge>`,
  );

  parts.push(
    `<policy_checks>\n${
      trace.policyChecks.length === 0
        ? 'none'
        : trace.policyChecks
            .map(
              (c) =>
                `${c.action}: ${c.decision} by rule ${c.ruleId} (${c.policyKey} ${c.policyVersion}) — ${c.reason}`,
            )
            .join('\n')
    }\n</policy_checks>`,
  );

  parts.push(
    `<tool_executions>\n${
      trace.toolExecutions.length === 0
        ? 'none'
        : trace.toolExecutions
            .map(
              (e) =>
                `${e.toolName} -> ${e.status}${e.errorCode ? ` (${e.errorCode})` : ''}${
                  e.verified === null ? '' : ` verified=${e.verified}`
                }\n  input: ${truncate(JSON.stringify(e.input), 300)}\n  output: ${truncate(
                  JSON.stringify(e.output ?? null),
                  300,
                )}`,
            )
            .join('\n')
    }\n</tool_executions>`,
  );

  parts.push(
    `<escalation>\n${
      trace.escalation ? `${trace.escalation.reason}: ${trace.escalation.note ?? ''}` : 'none'
    }\n</escalation>`,
  );

  parts.push(
    `<outcome>\n${trace.run.outcome ?? 'unknown'} in state ${trace.run.finalState ?? 'unknown'}\n</outcome>`,
  );

  return truncate(parts.join('\n\n'), MAX_CHARS);
}
