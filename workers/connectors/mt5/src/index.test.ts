import { describe, it, expect } from "vitest";
import handler from "./index";

describe("MT5 Connector Worker", () => {
  const mockEnv = { ENVIRONMENT: "test" };

  it("handles invalid requests with 405 or 400", async () => {
    const resGet = await handler.fetch(
      new Request("http://localhost/", { method: "GET" }),
      mockEnv
    );
    expect(resGet.status).toBe(405);

    const resParseErr = await handler.fetch(
      new Request("http://localhost/", { method: "POST", body: "invalid-json" }),
      mockEnv
    );
    expect(resParseErr.status).toBe(400);
    const body = (await resParseErr.json()) as any;
    expect(body.error.code).toBe(-32700);
  });

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
    expect(body.result.tools.length).toBe(2);
    expect(body.result.tools[0].name).toBe("get_mt5_account_info");
    expect(body.result.tools[1].name).toBe("get_mt5_positions");
  });

  it("returns sandbox account info on call_tool for account_info", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "get_mt5_account_info",
        },
        id: 2,
      }),
    });

    const res = await handler.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.result.content[0].type).toBe("text");
    const accountInfo = JSON.parse(body.result.content[0].text);
    expect(accountInfo.name).toContain("Sandbox");
    expect(accountInfo.balance).toBe(10000.0);
  });

  it("returns sandbox positions on call_tool for positions", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "get_mt5_positions",
        },
        id: 3,
      }),
    });

    const res = await handler.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const positions = JSON.parse(body.result.content[0].text);
    expect(Array.isArray(positions)).toBe(true);
    expect(positions.length).toBe(2);
    expect(positions[0].symbol).toBe("EURUSD");
  });

  it("filters sandbox positions by symbol", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "get_mt5_positions",
          arguments: {
            symbol: "GBPUSD",
          },
        },
        id: 4,
      }),
    });

    const res = await handler.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const positions = JSON.parse(body.result.content[0].text);
    expect(positions.length).toBe(1);
    expect(positions[0].symbol).toBe("GBPUSD");
  });
});
