import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "./index";

describe("Telegram Bot Worker", () => {
  const mockEnv = {
    ENVIRONMENT: "test",
    SUPABASE_URL: "https://mock.supabase.co",
    SUPABASE_SERVICE_KEY: "mock-key",
    TELEGRAM_BOT_TOKEN: "mock-tg-token",
    BYBIT_CONNECTOR: {
      fetch: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    // @ts-ignore
    global.fetch = vi.fn();
  });

  it("handles /start command", async () => {
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      body: JSON.stringify({
        update_id: 123,
        message: {
          chat: { id: 1111 },
          text: "/start",
        },
      }),
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    // @ts-ignore
    global.fetch = fetchMock;

    // @ts-ignore
    const res = await handler.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    const callUrl = fetchMock.mock.calls[0][0];
    expect(callUrl).toContain("botmock-tg-token/sendMessage");
  });

  it("handles /register command with valid key", async () => {
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      body: JSON.stringify({
        update_id: 124,
        message: {
          chat: { id: 1111 },
          text: "/register bm_mockkey12345",
        },
      }),
    });

    const fetchMock = vi.fn().mockImplementation((url) => {
      if (url.includes("/rest/v1/api_keys")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ user_id: "user-123", revoked: false }]),
        });
      }
      if (url.includes("/rest/v1/telegram_settings")) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ success: true })),
        });
      }
      if (url.includes("api.telegram.org")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        });
      }
      return Promise.resolve({ ok: false });
    });
    // @ts-ignore
    global.fetch = fetchMock;

    // @ts-ignore
    const res = await handler.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("transitions state on TradingView alerts", async () => {
    const req = new Request("http://localhost/webhook/tradingview", {
      method: "POST",
      body: JSON.stringify({
        ticker: "BTCUSDT",
        timeframe: "30m",
        type: "bias",
        direction: "long",
      }),
    });

    const fetchMock = vi.fn().mockImplementation((url) => {
      if (url.includes("/rest/v1/trading_presets")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ user_id: "user-123" }]),
          text: () => Promise.resolve(JSON.stringify([{ user_id: "user-123" }])),
        });
      }
      if (url.includes("/rest/v1/trading_states")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ state: "IDLE", bias_direction: "NONE" }]),
          text: () => Promise.resolve(JSON.stringify({ success: true })),
        });
      }
      if (url.includes("/rest/v1/telegram_settings")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ telegram_chat_id: "1111" }]),
          text: () => Promise.resolve(JSON.stringify([{ telegram_chat_id: "1111" }])),
        });
      }
      if (url.includes("api.telegram.org")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
          text: () => Promise.resolve(JSON.stringify({ ok: true })),
        });
      }
      return Promise.resolve({ ok: false });
    });
    // @ts-ignore
    global.fetch = fetchMock;

    // @ts-ignore
    const res = await handler.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
  });
});
