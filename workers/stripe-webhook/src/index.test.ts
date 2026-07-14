import { describe, it, expect, vi } from "vitest";
import handler from "./index";

// HMAC-SHA256 generator helper for generating valid test headers
async function generateStripeTestSignature(
  rawBody: string,
  timestamp: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${timestamp}.${rawBody}`);
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

  return Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("Stripe Webhook Worker", () => {
  const webhookSecret = "whsec_test_secret";
  const mockEnv = {
    ENVIRONMENT: "production",
    SUPABASE_URL: "https://mock.supabase.co",
    SUPABASE_SERVICE_KEY: "mock_service_key",
    STRIPE_WEBHOOK_SECRET: webhookSecret
  };

  it("blocks requests with missing or invalid signatures in production", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({ type: "ping" }),
      headers: { "stripe-signature": "invalid-format" }
    });

    const res = await handler.fetch(req, mockEnv);
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error).toContain("signature");
  });

  it("handles valid checkout.session.completed and upserts subscription in Supabase", async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const eventBody = {
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "user_test_99",
          customer: "cus_stripe_111",
          subscription: "sub_stripe_222",
          metadata: { tier: "pro" }
        }
      }
    };
    const bodyString = JSON.stringify(eventBody);
    const sig = await generateStripeTestSignature(bodyString, timestamp, webhookSecret);
    const signatureHeader = `t=${timestamp},v1=${sig}`;

    let dbWrites: Array<{ url: string; body: any }> = [];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = input.toString();
      if (init && init.method === "POST") {
        dbWrites.push({ url, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ success: true }));
      }
      return new Response("Not Found", { status: 404 });
    }) as any;

    try {
      const req = new Request("http://localhost/", {
        method: "POST",
        body: bodyString,
        headers: {
          "stripe-signature": signatureHeader,
          "Content-Type": "application/json"
        }
      });

      const res = await handler.fetch(req, mockEnv);
      expect(res.status).toBe(200);
      const resBody = (await res.json()) as any;
      expect(resBody.success).toBe(true);

      expect(dbWrites.length).toBe(1);
      expect(dbWrites[0].url).toContain("/rest/v1/subscriptions");
      expect(dbWrites[0].body.user_id).toBe("user_test_99");
      expect(dbWrites[0].body.stripe_customer_id).toBe("cus_stripe_111");
      expect(dbWrites[0].body.stripe_subscription_id).toBe("sub_stripe_222");
      expect(dbWrites[0].body.tier).toBe("pro");
      expect(dbWrites[0].body.status).toBe("active");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles customer.subscription.updated and updates tier/status", async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const eventBody = {
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_stripe_222",
          status: "past_due",
          current_period_end: 1720448100,
          metadata: { tier: "team" }
        }
      }
    };
    const bodyString = JSON.stringify(eventBody);
    const sig = await generateStripeTestSignature(bodyString, timestamp, webhookSecret);
    const signatureHeader = `t=${timestamp},v1=${sig}`;

    let dbPatches: Array<{ url: string; body: any }> = [];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = input.toString();
      if (init && init.method === "PATCH") {
        dbPatches.push({ url, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ success: true }));
      }
      return new Response("Not Found", { status: 404 });
    }) as any;

    try {
      const req = new Request("http://localhost/", {
        method: "POST",
        body: bodyString,
        headers: {
          "stripe-signature": signatureHeader,
          "Content-Type": "application/json"
        }
      });

      const res = await handler.fetch(req, mockEnv);
      expect(res.status).toBe(200);
      const resBody = (await res.json()) as any;
      expect(resBody.success).toBe(true);

      expect(dbPatches.length).toBe(1);
      expect(dbPatches[0].url).toContain("/rest/v1/subscriptions?stripe_subscription_id=eq.sub_stripe_222");
      expect(dbPatches[0].body.status).toBe("past_due");
      expect(dbPatches[0].body.tier).toBe("team");
      expect(dbPatches[0].body.current_period_end).toBe(new Date(1720448100 * 1000).toISOString());
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
