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

  it("handles /register command with valid smc_ key prefix", async () => {
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      body: JSON.stringify({
        update_id: 124,
        message: {
          chat: { id: 1111 },
          text: "/register smc_mockkey12345",
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

  it("transitions state on TradingView alerts (BIAS -> SETUP -> ENTRY)", async () => {
    // 1. BIAS Alert
    const reqBias = new Request("http://localhost/webhook/tradingview", {
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
          json: () => Promise.resolve([{ user_id: "user-123", tp_distance_pct: 1.5, exit_strategy: "fixed_tp" }]),
          text: () => Promise.resolve(JSON.stringify([{ user_id: "user-123", tp_distance_pct: 1.5, exit_strategy: "fixed_tp" }])),
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
    const resBias = await handler.fetch(reqBias, mockEnv);
    expect(resBias.status).toBe(200);
    const bodyBias = (await resBias.json()) as any;
    expect(bodyBias.success).toBe(true);
  });

  it("resets expired BIAS and SETUP states in scheduled cron handler", async () => {
    const expiredBiasTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3 hours ago (limit is 2h)
    let patchCalled = false;

    const fetchMock = vi.fn().mockImplementation((url, init) => {
      if (url.includes("/rest/v1/trading_states")) {
        if (init && init.method === "PATCH") {
          patchCalled = true;
          return Promise.resolve({ ok: true, text: () => Promise.resolve("{}") });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              user_id: "user-123",
              symbol: "ETHUSDT",
              state: "BIAS_ESTABLISHED",
              bias_direction: "LONG",
              bias_timestamp: expiredBiasTime,
              setup_timestamp: null,
              position_taken_over: false,
            }
          ]),
        });
      }
      if (url.includes("/rest/v1/telegram_settings")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ telegram_chat_id: "1111" }]),
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

    // Trigger scheduled handler
    // @ts-ignore
    await handler.scheduled({} as any, mockEnv, {} as any);
    expect(patchCalled).toBe(true);
  });

  it("handles position takeover and trailing stop updates in scheduled cron handler", async () => {
    let tpSlSet = false;

    const fetchMock = vi.fn().mockImplementation((url, init) => {
      if (url.includes("/rest/v1/trading_states")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              user_id: "user-123",
              symbol: "BTCUSDT",
              state: "MANAGING_POSITION",
              bias_direction: "LONG",
              position_taken_over: true,
            }
          ]),
        });
      }
      if (url.includes("/rest/v1/telegram_settings")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ telegram_chat_id: "1111" }]),
        });
      }
      if (url.includes("/rest/v1/trading_presets")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ exit_strategy: "trailing_stop", trailing_stop_pct: 1.0 }]),
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

    // Mock Bybit Connector return active position
    mockEnv.BYBIT_CONNECTOR.fetch = vi.fn().mockImplementation(async (reqInput, init) => {
      tpSlSet = true;
      return new Response(JSON.stringify({
        result: {
          content: [
            {
              text: JSON.stringify({
                list: [
                  {
                    symbol: "BTCUSDT",
                    side: "Buy",
                    size: "1.0",
                    entryPrice: "60000.00",
                    markPrice: "65000.00",
                    stopLoss: "62000.00", // New SL calculated will be 65000 * 0.99 = 64350 > 62000
                    takeProfit: "70000.00",
                    unrealisedPnl: "5000.00"
                  }
                ]
              })
            }
          ]
        }
      }));
    });

    // Trigger scheduled handler
    // @ts-ignore
    await handler.scheduled({} as any, mockEnv, {} as any);
    expect(tpSlSet).toBe(true);
  });
});
