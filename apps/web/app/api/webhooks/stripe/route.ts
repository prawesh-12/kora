import { handle } from '@/lib/api/errors';
import { handleStripeWebhookRequest } from '@/lib/webhooks/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const result = await handleStripeWebhookRequest(req);
    return Response.json({ received: true, ...result }, { status: 200 });
  });
}
