export interface Env {
  ENVIRONMENT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY?: string;
  VAULT_ENCRYPTION_KEY?: string;
  RATE_LIMIT: KVNamespace;
  MT5_CONNECTOR: { fetch: typeof fetch };
  BYBIT_CONNECTOR: { fetch: typeof fetch };
  TRADINGVIEW_CONNECTOR: { fetch: typeof fetch };
  FRED_CONNECTOR: { fetch: typeof fetch };
  OHLCV_CONNECTOR: { fetch: typeof fetch };
}

// Simple in-memory session mapping for SSE (useful in wrangler dev / single-instance)
const sseSessions = new Map<string, ReadableStreamDefaultController>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // Parse connector ID from path: /connectors/:connector_id/...
    const pathParts = path.split("/").filter(Boolean);
    if (pathParts[0] !== "connectors" || !pathParts[1]) {
      return new Response(
        JSON.stringify({ error: "Invalid endpoint. Use /connectors/:connector_id" }),
        { status: 404, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    const connectorId = pathParts[1];
    const action = pathParts[2] || ""; // 'sse', 'message', 'credentials', or empty

    // 1. Authenticate API Key
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Missing or invalid Authorization header" }),
        { status: 401, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }
    const rawKey = authHeader.substring(7).trim();

    let userId = "";
    let tier = "free";

    // Sandbox bypass check
    if (rawKey === "sb_sandbox_key") {
      userId = "00000000-0000-0000-0000-000000000000";
      tier = "trader";
    } else {
      // Validate key and fetch subscription against Supabase
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
        return new Response(
          JSON.stringify({ error: "Configuration error: Supabase credentials not set" }),
          { status: 500, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } }
        );
      }

      // Hash key with SHA-256 hex
      const hashedKey = await sha256Hex(rawKey);

      // Query Supabase for API Key
      const keyRes = await supabaseFetch(
        env,
        `/rest/v1/api_keys?key_hash=eq.${hashedKey}&select=user_id,revoked`
      );
      if (!keyRes || keyRes.length === 0 || keyRes[0].revoked) {
        return new Response(
          JSON.stringify({ error: "Unauthorized: Invalid or revoked API key" }),
          { status: 401, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } }
        );
      }
      userId = keyRes[0].user_id;

      // Query Supabase for Subscription Tier
      const subRes = await supabaseFetch(
        env,
        `/rest/v1/subscriptions?user_id=eq.${userId}&select=tier,status`
      );
      if (subRes && subRes.length > 0 && subRes[0].status === "active") {
        tier = subRes[0].tier;
      }
    }

    // 2. Handle Credentials Submission
    if (action === "credentials") {
      if (request.method !== "POST") {
        return new Response("Method not allowed. Use POST to upload credentials.", { status: 405 });
      }

      if (rawKey === "sb_sandbox_key") {
        return new Response(
          JSON.stringify({ error: "Unauthorized: Cannot write credentials using sandbox key" }),
          { status: 403, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } }
        );
      }

      if (!env.VAULT_ENCRYPTION_KEY) {
        return new Response(
          JSON.stringify({ error: "Configuration error: VAULT_ENCRYPTION_KEY not set" }),
          { status: 500, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } }
        );
      }

      try {
        const body: any = await request.json();
        const { label, credentials } = body;
        if (!label || !credentials) {
          return new Response(
            JSON.stringify({ error: "Bad request: missing label or credentials object" }),
            { status: 400, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } }
          );
        }

        // Encrypt credentials object
        const plaintextPayload = JSON.stringify(credentials);
        const encryptedPayload = await encryptPayload(plaintextPayload, env.VAULT_ENCRYPTION_KEY);

        // Postgrest upsert into public.credential_vault
        await supabaseWrite(
          env,
          "/rest/v1/credential_vault",
          {
            user_id: userId,
            connector_id: connectorId,
            label,
            encrypted_payload: encryptedPayload,
            encryption_key_version: 1,
          },
          { "Prefer": "resolution=merge-duplicates" }
        );

        // Log action in audit log
        await supabaseWrite(env, "/rest/v1/audit_log", {
          user_id: userId,
          action: "credential_created",
          metadata: { connector_id: connectorId, label },
        });

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } }
        );
      } catch (err: any) {
        return new Response(
          JSON.stringify({ error: err.message || "Failed to process credentials upload" }),
          { status: 500, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } }
        );
      }
    }

    // 3. Check Rate Limits
    const limit = getRateLimitForTier(tier);
    const todayStr = new Date().toISOString().split("T")[0];
    const kvKey = `rate_limit:${userId}:${todayStr}`;

    let count = 0;
    try {
      count = parseInt((await env.RATE_LIMIT.get(kvKey)) || "0", 10);
    } catch (e) {
      console.error("KV rate limit read error", e);
    }

    if (count >= limit) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded" }),
        { status: 429, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    try {
      await env.RATE_LIMIT.put(kvKey, (count + 1).toString(), { expirationTtl: 86400 });
    } catch (e) {
      console.error("KV rate limit write error", e);
    }

    // 4. Resolve & Decrypt Credentials
    let decryptedPayloadStr = "";
    if (rawKey === "sb_sandbox_key") {
      decryptedPayloadStr = JSON.stringify({ bridgeUrl: "sandbox", apiKey: "sandbox", apiSecret: "sandbox" });
    } else {
      if (!env.VAULT_ENCRYPTION_KEY) {
        return new Response(
          JSON.stringify({ error: "Configuration error: VAULT_ENCRYPTION_KEY not set" }),
          { status: 500, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } }
        );
      }

      // Fetch from Vault
      const vaultRes = await supabaseFetch(
        env,
        `/rest/v1/credential_vault?user_id=eq.${userId}&connector_id=eq.${connectorId}&select=encrypted_payload`
      );

      if (!vaultRes || vaultRes.length === 0) {
        // Fallback for demo: if no credentials found, default to sandbox
        decryptedPayloadStr = JSON.stringify({ bridgeUrl: "sandbox", apiKey: "sandbox", apiSecret: "sandbox" });
      } else {
        try {
          decryptedPayloadStr = await decryptPayload(
            vaultRes[0].encrypted_payload,
            env.VAULT_ENCRYPTION_KEY
          );
        } catch (err: any) {
          return new Response(
            JSON.stringify({ error: `Credential decryption failed: ${err.message}` }),
            { status: 500, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } }
          );
        }
      }
    }

    // Base64 encode the decrypted credentials payload for transmission over Service Binding
    const base64VaultPayload = btoa(decryptedPayloadStr);

    // 5. Route Dispatch to Connector Worker
    const connectorBinding = getConnectorBinding(env, connectorId);
    if (!connectorBinding) {
      return new Response(
        JSON.stringify({ error: `Connector not supported: ${connectorId}` }),
        { status: 400, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    // 6. Handle MCP Transport Modes: Direct POST vs. SSE
    if (action === "sse") {
      const sessionId = crypto.randomUUID();
      const responseStream = new ReadableStream({
        start(controller) {
          sseSessions.set(sessionId, controller);
          
          // Send initial session/endpoint information
          const endpointUrl = `${url.origin}/connectors/${connectorId}/message?sessionId=${sessionId}`;
          controller.enqueue(
            new TextEncoder().encode(
              `event: endpoint\ndata: ${endpointUrl}\n\n`
            )
          );
        },
        cancel() {
          sseSessions.delete(sessionId);
        },
      });

      return new Response(responseStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    if (action === "message") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        return new Response(JSON.stringify({ error: "Missing sessionId parameter" }), {
          status: 400,
          headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      const controller = sseSessions.get(sessionId);
      if (!controller) {
        return new Response(JSON.stringify({ error: "Session expired or invalid" }), {
          status: 410,
          headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      // Clone request and forward payload
      const mcpRequestText = await request.text();
      const connectorRequest = new Request(request.url, {
        method: "POST",
        body: mcpRequestText,
        headers: {
          "Content-Type": "application/json",
          "x-vault-payload": base64VaultPayload,
        },
      });

      // Call connector and route response back through SSE
      const connectorResponse = await connectorBinding.fetch(connectorRequest);
      const connectorResponseText = await connectorResponse.text();

      // Write to SSE
      controller.enqueue(
        new TextEncoder().encode(
          `event: message\ndata: ${connectorResponseText.replace(/\n/g, "")}\n\n`
        )
      );

      // Return HTTP 202 Accepted for the POST request
      return new Response("Accepted", {
        status: 202,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // Direct stateless JSON-RPC POST (fallback/preferred for simple HTTP clients)
    const mcpRequestText = await request.text();
    const connectorRequest = new Request(request.url, {
      method: "POST",
      body: mcpRequestText,
      headers: {
        "Content-Type": "application/json",
        "x-vault-payload": base64VaultPayload,
      },
    });

    const connectorResponse = await connectorBinding.fetch(connectorRequest);
    const responseHeaders = new Headers(connectorResponse.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");

    return new Response(connectorResponse.body, {
      status: connectorResponse.status,
      headers: responseHeaders,
    });
  },
};

// --- Helper Functions ---

async function sha256Hex(text: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function supabaseFetch(env: Env, endpoint: string): Promise<any> {
  const response = await fetch(`${env.SUPABASE_URL}${endpoint}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY || "",
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY || ""}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase query failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

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

  // Response might be empty for Postgrest unless return=representation is specified
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function getRateLimitForTier(tier: string): number {
  switch (tier) {
    case "free":
      return 100;
    case "trader":
      return 10000;
    case "pro":
      return 50000;
    case "team":
      return 200000;
    default:
      return 100;
  }
}

function getConnectorBinding(env: Env, connectorId: string) {
  if (connectorId === "mt5") {
    return env.MT5_CONNECTOR;
  }
  if (connectorId === "bybit") {
    return env.BYBIT_CONNECTOR;
  }
  if (connectorId === "tradingview") {
    return env.TRADINGVIEW_CONNECTOR;
  }
  if (connectorId === "fred") {
    return env.FRED_CONNECTOR;
  }
  if (connectorId === "ohlcv") {
    return env.OHLCV_CONNECTOR;
  }
  return null;
}

// AES-GCM Encryption
async function encryptPayload(plaintext: string, secretKeyHex: string): Promise<string> {
  const keyBytes = hexOrBase64ToUint8Array(secretKeyHex, "hex");
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );

  const ivBase64 = btoa(String.fromCharCode(...iv));
  const ciphertextBase64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));

  return `${ivBase64}:${ciphertextBase64}`;
}

// AES-GCM Decryption
async function decryptPayload(encryptedPayload: string, secretKeyHex: string): Promise<string> {
  const [ivBase64, ciphertextBase64] = encryptedPayload.split(":");
  if (!ivBase64 || !ciphertextBase64) {
    throw new Error("Invalid encrypted payload format");
  }

  const iv = hexOrBase64ToUint8Array(ivBase64, "base64");
  const ciphertext = hexOrBase64ToUint8Array(ciphertextBase64, "base64");
  const keyBytes = hexOrBase64ToUint8Array(secretKeyHex, "hex");

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

function hexOrBase64ToUint8Array(str: string, encoding: "hex" | "base64"): Uint8Array {
  if (encoding === "hex") {
    const bytes = new Uint8Array(str.length / 2);
    for (let i = 0; i < str.length; i += 2) {
      bytes[i / 2] = parseInt(str.substring(i, i + 2), 16);
    }
    return bytes;
  } else {
    const binString = atob(str);
    const bytes = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) {
      bytes[i] = binString.charCodeAt(i);
    }
    return bytes;
  }
}
