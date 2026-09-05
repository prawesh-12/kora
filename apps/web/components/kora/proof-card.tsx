'use client';

import { CircleAlert, Clock3, ShieldCheck } from 'lucide-react';
import { Money, StripeId } from '@/components/kora/money';
import { formatAbsolute } from '@/lib/ops/format';
import { cn } from '@/lib/utils';

export type ProofStatus = 'verified' | 'pending' | 'denied' | 'failed';

export interface ProofCardProps {
  status: ProofStatus;
  /** Customer language: "Refund confirmed", "Cancellation scheduled for 14 June". */
  title: string;
  amountMinor?: number | null;
  currency?: string | null;
  /** The policy rule that decided, in plain words. */
  policyRule?: string | null;
  /** Real Stripe id from the write, e.g. re_1S.... */
  stripeId?: string | null;
  verifiedAt?: string | Date | null;
  failureReason?: string | null;
  compact?: boolean;
}

function Beat({
  ordinal,
  heading,
  children,
  muted,
}: {
  ordinal: string;
  heading: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <li className={cn('flex gap-3', muted && 'text-muted-foreground')}>
      <span
        aria-hidden
        className="tnum flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs"
      >
        {ordinal}
      </span>
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-sm">{heading}</p>
        <div className="text-sm">{children}</div>
      </div>
    </li>
  );
}

/** The drawn check appears on a real confirmation only: never on pending,
 *  denied or failed. */
export function ProofCard({
  status,
  title,
  amountMinor = null,
  currency = null,
  policyRule = null,
  stripeId = null,
  verifiedAt = null,
  failureReason = null,
  compact,
}: ProofCardProps) {
  return (
    <section
      aria-label={title}
      className={cn('rounded-[10px] border bg-card', compact ? 'p-4' : 'p-5')}
      data-testid={`proof-card-${status}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {/* Not a heading: the card renders under headings of several levels, and the
            section already carries the title as its accessible name. */}
        <p className="font-semibold text-base">{title}</p>
        {amountMinor !== null ? <Money amountMinor={amountMinor} currency={currency} /> : null}
      </div>

      {status === 'denied' ? (
        <ol className="flex flex-col gap-4 pt-4">
          <Beat heading="Requested" ordinal="1">
            <p className="text-muted-foreground text-sm">
              {policyRule ?? 'The policy did not allow this.'}
            </p>
            {failureReason ? <p className="text-sm">{failureReason}</p> : null}
          </Beat>
        </ol>
      ) : status === 'failed' ? (
        <ol className="flex flex-col gap-4 pt-4">
          <Beat heading="Requested" ordinal="1">
            <p className="text-muted-foreground text-sm">
              {policyRule ?? 'The action was allowed and started.'}
            </p>
          </Beat>
          <Beat heading="Did not complete" ordinal="2">
            <p className="flex items-start gap-2 text-sm">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive-strong" />
              <span>
                {failureReason ?? 'The action could not be completed.'} A person has been brought in
                and will follow up.
              </span>
            </p>
          </Beat>
        </ol>
      ) : (
        <ol className="flex flex-col gap-4 pt-4">
          <Beat heading="Requested" ordinal="1">
            <p className="text-muted-foreground text-sm">
              {policyRule ?? 'The request was checked against policy.'}
            </p>
          </Beat>
          <Beat heading="Executed" ordinal="2">
            {stripeId ? (
              <StripeId id={stripeId} />
            ) : (
              <p className="text-muted-foreground text-sm">Recorded, waiting for the reference.</p>
            )}
          </Beat>
          <Beat heading="Verified" muted={status === 'pending'} ordinal="3">
            {status === 'verified' ? (
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className="proof-check-draw inline-flex size-5 items-center justify-center rounded-full bg-success/10"
                >
                  <svg height="14" viewBox="0 0 16 16" width="14">
                    <title>Confirmed</title>
                    <path
                      className="proof-check-path"
                      d="M3 8.5 L6.5 12 L13 4.5"
                      fill="none"
                      stroke="var(--success-strong)"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.2"
                    />
                  </svg>
                </span>
                <span>
                  Confirmed in Stripe
                  {verifiedAt ? (
                    <span className="text-muted-foreground" title={formatAbsolute(verifiedAt)}>
                      {' '}
                      · {formatAbsolute(verifiedAt)}
                    </span>
                  ) : null}
                </span>
              </p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-warning-strong">
                <Clock3 aria-hidden className="size-4 shrink-0" />
                <span>
                  Waiting on Stripe. This confirms automatically once Stripe reports back.
                </span>
              </p>
            )}
          </Beat>
        </ol>
      )}

      <p className="flex items-center gap-1.5 pt-4 text-muted-foreground text-xs">
        <ShieldCheck aria-hidden className="size-3.5" />
        Read back from Stripe, not assumed from the request.
      </p>
    </section>
  );
}
