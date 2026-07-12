import { describe, it, expect } from "vitest";
import handler from "./index";

// AES-GCM Encrypter for test seed generation
async function encryptPayload(plaintext: string, secretKeyHex: string): Promise<string> {
  const hexToBytes = (hex: string) => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  };

  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(secretKeyHex),
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

describe("Gateway Worker", () => {
  const secretKeyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const getMockEnv = (overrides = {}) => {
    const rateLimitStorage = new Map<string, string>();
    return {
      ENVIRONMENT: "test",
      SUPABASE_URL: "https://mock.supabase.co",
      SUPABASE_SERVICE_KEY: "mock_service_key",
      VAULT_ENCRYPTION_KEY: secretKeyHex,
      RATE_LIMIT: {
        get: async (key: string) => rateLimitStorage.get(key) || null,
        put: async (key: string, value: string) => { rateLimitStorage.set(key, value); },
      } as any,
      MT5_CONNECTOR: {
        fetch: (async (input: any, init?: any) => {
          const req = new Request(input, init);
          const payload = req.headers.get("x-vault-payload");
          return new Response(JSON.stringify({
            result: {
              success: true,
              receivedPayload: payload ? JSON.parse(atob(payload)) : null
            }
          }));
        }) as any
      },
      BYBIT_CONNECTOR: {
        fetch: (async (input: any, init?: any) => {
          const req = new Request(input, init);
          const payload = req.headers.get("x-vault-payload");
          return new Response(JSON.stringify({
            result: {
              success: true,
              receivedPayload: payload ? JSON.parse(atob(payload)) : null
            }
          }));
        }) as any
      },
      TRADINGVIEW_CONNECTOR: {
        fetch: (async (input: any, init?: any) => {
          const req = new Request(input, init);
          const payload = req.headers.get("x-vault-payload");
          return new Response(JSON.stringify({
            result: {
              success: true,
              receivedPayload: payload ? JSON.parse(atob(payload)) : null
            }
          }));
        }) as any
      },
      FRED_CONNECTOR: {
        fetch: (async (input: any, init?: any) => {
          const req = new Request(input, init);
          const payload = req.headers.get("x-vault-payload");
          return new Response(JSON.stringify({
            result: {
              success: true,
              receivedPayload: payload ? JSON.parse(atob(payload)) : null
            }
          }));
        }) as any
      },
      OHLCV_CONNECTOR: {
        fetch: (async (input: any, init?: any) => {
          const req = new Request(input, init);
          const payload = req.headers.get("x-vault-payload");
          return new Response(JSON.stringify({
            result: {
              success: true,
              receivedPayload: payload ? JSON.parse(atob(payload)) : null
            }
          }));
        }) as any
      },
      ...overrides
    };
  };

  it("returns 404 for invalid endpoint path", async () => {
    const env = getMockEnv();
    const req = new Request("http://localhost/invalid-path", {
      headers: { "Authorization": "Bearer sb_sandbox_key" }
    });
    const res = await handler.fetch(req, env as any);
    expect(res.status).toBe(404);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const env = getMockEnv();
    const req = new Request("http://localhost/connectors/mt5");
    const res = await handler.fetch(req, env as any);
    expect(res.status).toBe(401);
  });

  it("handles the sandbox key bypass correctly for MT5 and Bybit", async () => {
    const env = getMockEnv();
    
    // Test MT5 routing
    const reqMt5 = new Request("http://localhost/connectors/mt5", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
      headers: {
        "Authorization": "Bearer sb_sandbox_key",
        "Content-Type": "application/json"
      }
    });
    const resMt5 = await handler.fetch(reqMt5, env as any);
    expect(resMt5.status).toBe(200);
    const bodyMt5 = (await resMt5.json()) as any;
    expect(bodyMt5.result.success).toBe(true);
    expect(bodyMt5.result.receivedPayload.bridgeUrl).toBe("sandbox");

    // Test Bybit routing
    const reqBybit = new Request("http://localhost/connectors/bybit", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 2 }),
      headers: {
        "Authorization": "Bearer sb_sandbox_key",
        "Content-Type": "application/json"
      }
    });
    const resBybit = await handler.fetch(reqBybit, env as any);
    expect(resBybit.status).toBe(200);
    const bodyBybit = (await resBybit.json()) as any;
    expect(bodyBybit.result.success).toBe(true);
    expect(bodyBybit.result.receivedPayload.apiKey).toBe("sandbox");
  });

  it("authenticates using Supabase lookup and decrypts valid credentials", async () => {
    const env = getMockEnv();
    
    // Encrypt a mock configuration payload
    const rawConfig = { bridgeUrl: "http://my-mt5-bridge.local", bridgeToken: "top-secret" };
    const cipherText = await encryptPayload(JSON.stringify(rawConfig), secretKeyHex);

    // Save and stub the global fetch method
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = input.toString();
      if (url.includes("/rest/v1/api_keys")) {
        return new Response(JSON.stringify([{ user_id: "user-123", revoked: false }]));
      }
      if (url.includes("/rest/v1/subscriptions")) {
        return new Response(JSON.stringify([{ tier: "trader", status: "active" }]));
      }
      if (url.includes("/rest/v1/credential_vault")) {
        return new Response(JSON.stringify([{ encrypted_payload: cipherText }]));
      }
      return new Response("Not Found", { status: 404 });
    }) as any;

    try {
      const req = new Request("http://localhost/connectors/mt5", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
        headers: {
          "Authorization": "Bearer live_test_key_123",
          "Content-Type": "application/json"
        }
      });

      const res = await handler.fetch(req, env as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.result.success).toBe(true);
      expect(body.result.receivedPayload.bridgeUrl).toBe("http://my-mt5-bridge.local");
      expect(body.result.receivedPayload.bridgeToken).toBe("top-secret");
    } finally {
      // Clean up the global fetch stub
      globalThis.fetch = originalFetch;
    }
  });

  it("handles secure credentials uploads and stores encrypted ciphertext", async () => {
    const env = getMockEnv();

    let dbWrites: Array<{ url: string; body: any }> = [];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = input.toString();
      if (url.includes("/rest/v1/api_keys")) {
        return new Response(JSON.stringify([{ user_id: "user-123", revoked: false }]));
      }
      if (url.includes("/rest/v1/subscriptions")) {
        return new Response(JSON.stringify([{ tier: "trader", status: "active" }]));
      }
      if (init && init.method === "POST") {
        dbWrites.push({ url, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ success: true }));
      }
      return new Response("Not Found", { status: 404 });
    }) as any;

    try {
      const payload = { apiKey: "bybit-key-123", apiSecret: "bybit-secret-456" };
      const req = new Request("http://localhost/connectors/bybit/credentials", {
        method: "POST",
        body: JSON.stringify({
          label: "My Bybit Test",
          credentials: payload
        }),
        headers: {
          "Authorization": "Bearer live_test_key_123",
          "Content-Type": "application/json"
        }
      });

      const res = await handler.fetch(req, env as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);

      // Verify that two database writes occurred (credential vault upsert and audit log entry)
      expect(dbWrites.length).toBe(2);
      
      const vaultWrite = dbWrites.find(w => w.url.includes("/rest/v1/credential_vault"));
      expect(vaultWrite).toBeDefined();
      expect(vaultWrite!.body.user_id).toBe("user-123");
      expect(vaultWrite!.body.connector_id).toBe("bybit");
      expect(vaultWrite!.body.label).toBe("My Bybit Test");
      expect(vaultWrite!.body.encrypted_payload).toContain(":"); // IV and ciphertext separated by colon
      
      const auditWrite = dbWrites.find(w => w.url.includes("/rest/v1/audit_log"));
      expect(auditWrite).toBeDefined();
      expect(auditWrite!.body.action).toBe("credential_created");
      expect(auditWrite!.body.metadata.connector_id).toBe("bybit");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
