import { childLogger, serverEnv } from '@kora/core';

export interface ApprovalNotification {
  approvalId: string;
  conversationId: string;
  runId: string;
  toolName: string;
  reason: string;
  amountMinor: number | null;
  currency: string | null;
  requestedAt: string;
  expiresAt: string;
  url: string;
}

const TIMEOUT_MS = 3_000;

export function approvalWebhookUrl(): string | null {
  return serverEnv().KORA_APPROVAL_WEBHOOK_URL ?? null;
}

/**
 * One POST, no retries, no queue. A dead endpoint is logged and dropped: an
 * approval a customer is already waiting on must never fail because a chat
 * integration is down.
 */
export async function notifyApprovalPending(
  notification: ApprovalNotification,
  endpoint: string,
): Promise<boolean> {
  const log = childLogger({ approvalId: notification.approvalId });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'approval.pending', approval: notification }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      log.warn({ status: response.status }, 'approval webhook rejected the notification');
      return false;
    }
    return true;
  } catch (e) {
    log.warn({ err: e }, 'approval webhook could not be reached');
    return false;
  }
}
