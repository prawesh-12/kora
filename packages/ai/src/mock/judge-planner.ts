import type { MockPlanner, MockPlannerContext } from './language-model.js';

type Verdict = 'MET' | 'UNMET' | 'CANNOT_ASSESS';

function section(transcript: string, tag: string): string {
  const match = transcript.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match?.[1]?.trim() ?? '';
}

function criterionIds(prompt: string): string[] {
  const rubric = section(prompt, 'rubric[^>]*');
  const body = rubric || prompt;
  return [...body.matchAll(/^- ([a-z_]+):/gm)].map((m) => m[1] ?? '').filter(Boolean);
}

const REPLACEMENT_ID = /\bREP-\d+\b/g;
const REFUND_ID = /\bREF-\d+\b/g;
const CANCELLATION_ID = /\bCAN-\d+\b/g;

/**
 * The offline judge.
 *
 * It reads the same rendered trace a real judge would and answers each criterion
 * from what the trace actually contains. It is a different family from the agent
 * planner on purpose: the family check in `@kora/evaluation` is enforced, and a
 * judge that shared the agent's reasoning would be worthless.
 *
 * What it cannot do is have an opinion. On anything requiring judgement rather
 * than a lookup, it answers CANNOT_ASSESS rather than inventing agreement.
 */
export const judgePlanner: MockPlanner = (ctx: MockPlannerContext) => {
  if (ctx.options.responseFormat?.type !== 'json') return undefined;

  const prompt = ctx.customerText || ctx.transcript;
  const ids = criterionIds(prompt);
  if (ids.length === 0) return undefined;

  const conversation = section(prompt, 'conversation');
  const policyChecks = section(prompt, 'policy_checks');
  const toolExecutions = section(prompt, 'tool_executions');
  const escalation = section(prompt, 'escalation');
  const retrieved = section(prompt, 'retrieved_knowledge');
  const outcome = section(prompt, 'outcome');

  const agentLines = conversation
    .split('\n')
    .filter((l) => l.startsWith('agent:'))
    .join('\n');

  const answer = (id: string): { verdict: Verdict; evidence: string } => {
    switch (id) {
      case 'explanation_matches_policy': {
        if (policyChecks === 'none' || policyChecks === '') {
          return { verdict: 'CANNOT_ASSESS', evidence: 'no policy check is recorded' };
        }
        const denial = policyChecks.match(/: deny by rule \S+ \([^)]*\) — (.+)/);
        if (!denial) {
          return {
            verdict: 'MET',
            evidence: 'nothing was denied, so no denial had to be explained',
          };
        }
        // Compare the stated reason with the recorded one on its distinctive words.
        const words = (denial[1] ?? '')
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length > 4);
        const stated = agentLines.toLowerCase();
        const overlap = words.filter((w) => stated.includes(w)).length;
        return overlap >= Math.min(2, words.length)
          ? { verdict: 'MET', evidence: `the reply repeats the recorded reason: ${denial[1]}` }
          : { verdict: 'UNMET', evidence: `recorded reason "${denial[1]}" is not in the reply` };
      }

      case 'no_unsupported_claims': {
        const claimed = [
          ...(agentLines.match(REPLACEMENT_ID) ?? []),
          ...(agentLines.match(REFUND_ID) ?? []),
          ...(agentLines.match(CANCELLATION_ID) ?? []),
        ];
        const unsupported = claimed.filter(
          (id) => !toolExecutions.includes(id) && !retrieved.includes(id),
        );
        return unsupported.length === 0
          ? { verdict: 'MET', evidence: 'every id in the reply appears in a tool result' }
          : { verdict: 'UNMET', evidence: `not in any tool result: ${unsupported.join(', ')}` };
      }

      case 'intent_understood': {
        const intent = section(prompt, 'intent');
        return intent && !intent.startsWith('none')
          ? { verdict: 'MET', evidence: `detected ${intent}` }
          : { verdict: 'CANNOT_ASSESS', evidence: 'no intent was recorded' };
      }

      case 'escalation_reason_valid': {
        if (escalation === 'none') {
          return { verdict: 'CANNOT_ASSESS', evidence: 'the run did not escalate' };
        }
        const reason = escalation.split(':')[0] ?? '';
        const supported =
          (reason === 'TOOL_FAILED' && /-> failed/.test(toolExecutions)) ||
          (reason === 'VERIFICATION_FAILED' && /verified=false/.test(toolExecutions)) ||
          (reason === 'CUSTOMER_REQUESTED' && /bot|person|human/i.test(conversation)) ||
          (reason === 'UNSUPPORTED_SCENARIO' &&
            /nothing was retrieved|-> failed/.test(`${retrieved}${toolExecutions}`)) ||
          reason === 'LOW_CONFIDENCE' ||
          reason === 'APPROVAL_DENIED' ||
          reason === 'MAX_STEPS_REACHED';
        return supported
          ? { verdict: 'MET', evidence: `${reason} is supported by the trace` }
          : { verdict: 'UNMET', evidence: `${reason} is not supported by anything in the trace` };
      }

      case 'tone_appropriate': {
        const bad = ['your fault', 'you should have', 'obviously', 'guaranteed', 'definitely will'];
        const found = bad.filter((p) => agentLines.toLowerCase().includes(p));
        return found.length === 0
          ? { verdict: 'MET', evidence: 'no blame and no over-promising in the reply' }
          : { verdict: 'UNMET', evidence: `problematic phrasing: ${found.join(', ')}` };
      }

      case 'no_dead_end': {
        if (outcome.startsWith('resolved_automatically')) {
          return {
            verdict: 'CANNOT_ASSESS',
            evidence: 'the run resolved, so there is no dead end',
          };
        }
        const tellsNext = /colleague|shortly|get back|follow up|confirm|someone will/i.test(
          agentLines,
        );
        return tellsNext
          ? { verdict: 'MET', evidence: 'the reply says who picks it up next' }
          : { verdict: 'UNMET', evidence: 'the reply does not say what happens next' };
      }

      default:
        return { verdict: 'CANNOT_ASSESS', evidence: 'this judge has no rule for that criterion' };
    }
  };

  return {
    text: JSON.stringify({
      verdicts: ids.map((id) => ({ criterionId: id, ...answer(id) })),
    }),
  };
};
