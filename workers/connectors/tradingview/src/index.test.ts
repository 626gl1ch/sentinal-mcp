import { describe, it, expect } from "vitest";
import handler from "./index";

describe("TradingView Connector Worker", () => {
  const mockEnv = { ENVIRONMENT: "test" };

  it("registers alert via POST /webhook and retrieves it via MCP", async () => {
    // 1. Submit webhook alert
    const postReq = new Request("http://localhost/webhook", {
      method: "POST",
      body: JSON.stringify({
        ticker: "SOLUSDT",
        action: "buy",
        price: 140.0,
        message: "Breakout Long",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const postRes = await handler.fetch(postReq, mockEnv);
    expect(postRes.status).toBe(200);
    const postBody = (await postRes.json()) as any;
    expect(postBody.success).toBe(true);

    // 2. Fetch via MCP call_tool
    const mcpReq = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "get_tradingview_alerts",
          arguments: { symbol: "SOLUSDT" },
        },
        id: 1,
      }),
    });

    const mcpRes = await handler.fetch(mcpReq, mockEnv);
    expect(mcpRes.status).toBe(200);
    const mcpBody = (await mcpRes.json()) as any;
    const alerts = JSON.parse(mcpBody.result.content[0].text);
    expect(alerts.length).toBe(1);
    expect(alerts[0].ticker).toBe("SOLUSDT");
    expect(alerts[0].price).toBe(140.0);
  });
});
