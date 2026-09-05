import { handle } from '@/lib/api/errors';
import { handleStripeWebhookRequest } from '@/lib/webhooks/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Stripe signs the exact bytes posted. `req.text()` preserves them; parsing to
// JSON first would re-serialize whitespace and break the signature. The App
// Router has no bodyParser option, so reading the raw text here is the whole
// mechanism. `stripe-signature` is the only header this route trusts.
export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const result = await handleStripeWebhookRequest(req);
    return Response.json({ received: true, ...result }, { status: 200 });
  });
}
