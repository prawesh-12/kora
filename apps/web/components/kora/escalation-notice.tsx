'use client';

import { UserRound } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const REASON_COPY: Record<string, string> = {
  CUSTOMER_REQUESTED: 'You asked to speak to someone, so we have passed you over.',
  LOW_CONFIDENCE: 'We want to be sure this is handled properly, so a person is taking a look.',
  POLICY_REQUIRES_HUMAN: 'This one needs a person to sign it off.',
  POLICY_DENIED: 'We cannot do this automatically, so a colleague is picking it up.',
  APPROVAL_DENIED: 'A colleague reviewed this and is handling it directly.',
  TOOL_FAILED: 'Something went wrong on our side, so a colleague is picking this up.',
  VERIFICATION_FAILED: 'We could not confirm the change went through, so a person is checking.',
  UNSUPPORTED_SCENARIO: 'This is outside what we can handle here, so a colleague will take it.',
  MAX_STEPS_REACHED: 'This is taking longer than expected, so a colleague is taking over.',
};

export function EscalationNotice({ reason }: { reason: string }) {
  return (
    <Alert data-testid="escalation-notice">
      <UserRound />
      <AlertTitle>Passed to a colleague</AlertTitle>
      <AlertDescription>
        {REASON_COPY[reason] ?? 'A colleague is picking this up and will be in touch shortly.'}
      </AlertDescription>
    </Alert>
  );
}
