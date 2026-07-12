import { describe, it, expect } from "vitest";
import handler from "./index";

describe("OHLCV Connector Worker", () => {
  const mockEnv = { ENVIRONMENT: "test" };

  it("lists tools successfully on tools/list method", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        id: 1,
      }),
    });

    const res = await handler.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.result.tools).toBeDefined();
    expect(body.result.tools[0].name).toBe("get_normalized_ohlcv");
  });

  it("returns sandbox candles on call_tool for get_normalized_ohlcv", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "get_normalized_ohlcv",
          arguments: {
            symbol: "BTCUSDT",
            limit: 5
          },
        },
        id: 2,
      }),
    });

    const res = await handler.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const data = JSON.parse(body.result.content[0].text);
    expect(data.symbol).toBe("BTCUSDT");
    expect(data.candles.length).toBe(5);
    expect(data.candles[0].open).toBeDefined();
  });
});
