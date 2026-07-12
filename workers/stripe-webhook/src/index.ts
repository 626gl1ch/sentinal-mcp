export interface Env {
  ENVIRONMENT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed. Webhook accepts POST requests only.", { status: 405 });
    }

    const signature = request.headers.get("stripe-signature");
    const rawBody = await request.text();

    // 1. Verify Webhook Signature
    if (env.ENVIRONMENT === "production") {
      if (!signature || !env.STRIPE_WEBHOOK_SECRET) {
        return new Response(JSON.stringify({ error: "Missing webhook signature or secret" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }

      const isValid = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
      if (!isValid) {
        return new Response(JSON.stringify({ error: "Invalid webhook signature" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
    }

    // 2. Parse Event JSON
    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch (err) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const { type, data } = event;
    const sessionOrSub = data?.object;

    if (!sessionOrSub) {
      return new Response(JSON.stringify({ error: "Missing data payload" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    try {
      if (type === "checkout.session.completed") {
        const userId = sessionOrSub.client_reference_id || sessionOrSub.metadata?.user_id;
        const customerId = sessionOrSub.customer;
        const subscriptionId = sessionOrSub.subscription;
        const tier = sessionOrSub.metadata?.tier || "trader";

        if (!userId || !customerId || !subscriptionId) {
          return new Response(JSON.stringify({ error: "Incomplete checkout session details" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        // Upsert subscription into Supabase
        await supabaseWrite(
          env,
          "/rest/v1/subscriptions",
          {
            user_id: userId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            tier: tier,
            status: "active",
            updated_at: new Date().toISOString()
          },
          { "Prefer": "resolution=merge-duplicates" }
        );
      }

      else if (type === "customer.subscription.updated") {
        const subscriptionId = sessionOrSub.id;
        const status = sessionOrSub.status; // 'active', 'past_due', 'unpaid', 'canceled'
        const currentPeriodEnd = sessionOrSub.current_period_end; // timestamp in sec
        const tier = sessionOrSub.metadata?.tier;

        const currentPeriodEndIso = currentPeriodEnd 
          ? new Date(currentPeriodEnd * 1000).toISOString() 
          : null;

        const updatePayload: Record<string, any> = {
          status,
          current_period_end: currentPeriodEndIso,
          updated_at: new Date().toISOString()
        };
        if (tier) {
          updatePayload.tier = tier;
        }

        // Patch subscription by Stripe ID
        await supabasePatch(
          env,
          `/rest/v1/subscriptions?stripe_subscription_id=eq.${subscriptionId}`,
          updatePayload
        );
      }

      else if (type === "customer.subscription.deleted") {
        const subscriptionId = sessionOrSub.id;

        // Downgrade user's status to canceled
        await supabasePatch(
          env,
          `/rest/v1/subscriptions?stripe_subscription_id=eq.${subscriptionId}`,
          {
            status: "canceled",
            updated_at: new Date().toISOString()
          }
        );
      }

      else if (type === "invoice.payment_failed") {
        const subscriptionId = sessionOrSub.subscription;
        if (subscriptionId) {
          // Set status to past_due
          await supabasePatch(
            env,
            `/rest/v1/subscriptions?stripe_subscription_id=eq.${subscriptionId}`,
            {
              status: "past_due",
              updated_at: new Date().toISOString()
            }
          );
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { "content-type": "application/json" }
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message || "Database operation failed" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  },
};

// --- Signature Verification Helper ---

async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string
): Promise<boolean> {
  const parts = signatureHeader.split(",");
  const tPart = parts.find(p => p.trim().startsWith("t="));
  const v1Part = parts.find(p => p.trim().startsWith("v1="));
  if (!tPart || !v1Part) return false;

  const t = tPart.trim().substring(2);
  const v1 = v1Part.trim().substring(3);

  const encoder = new TextEncoder();
  const data = encoder.encode(`${t}.${rawBody}`);
  const keyBytes = encoder.encode(secret);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    data
  );

  const computedSig = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return computedSig === v1;
}

// --- Supabase REST Client Helpers ---

async function supabaseWrite(env: Env, endpoint: string, body: any, extraHeaders: Record<string, string> = {}): Promise<any> {
  const response = await fetch(`${env.SUPABASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY || "",
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY || ""}`,
      "Content-Type": "application/json",
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Supabase write failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function supabasePatch(env: Env, endpoint: string, body: any): Promise<any> {
  const response = await fetch(`${env.SUPABASE_URL}${endpoint}`, {
    method: "PATCH",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY || "",
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY || ""}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Supabase patch failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
