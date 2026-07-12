import { describe, it, expect } from "vitest";
import handler from "./index";

describe("Bybit Connector Worker", () => {
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
    expect(body.result.tools.length).toBe(5);
    expect(body.result.tools[0].name).toBe("get_bybit_account_info");
    expect(body.result.tools[1].name).toBe("get_bybit_positions");
    expect(body.result.tools[2].name).toBe("get_bybit_orders");
    expect(body.result.tools[3].name).toBe("set_bybit_tp_sl");
    expect(body.result.tools[4].name).toBe("place_bybit_order");
  });

  it("returns sandbox account info on call_tool for get_bybit_account_info", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "get_bybit_account_info",
        },
        id: 2,
      }),
    });

    const res = await handler.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const info = JSON.parse(body.result.content[0].text);
    expect(info.list[0].totalWalletBalance).toBe("25000.00");
  });

  it("returns sandbox positions on call_tool for get_bybit_positions", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "get_bybit_positions",
        },
        id: 3,
      }),
    });

    const res = await handler.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const data = JSON.parse(body.result.content[0].text);
    expect(data.list.length).toBe(2);
    expect(data.list[0].symbol).toBe("BTCUSDT");
  });

  it("filters sandbox positions by symbol", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "get_bybit_positions",
          arguments: {
            symbol: "ETHUSDT",
          },
        },
        id: 4,
      }),
    });

    const res = await handler.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const data = JSON.parse(body.result.content[0].text);
    expect(data.list.length).toBe(1);
    expect(data.list[0].symbol).toBe("ETHUSDT");
  });

  it("returns sandbox orders on call_tool for get_bybit_orders", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "get_bybit_orders",
          arguments: {
            limit: 1,
          },
        },
        id: 5,
      }),
    });

    const res = await handler.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const data = JSON.parse(body.result.content[0].text);
    expect(data.list.length).toBe(1);
    expect(data.list[0].orderId).toBe("ord-998877");
  });

  it("returns mock success for set_bybit_tp_sl in sandbox mode", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "set_bybit_tp_sl",
          arguments: {
            symbol: "BTCUSDT",
            takeProfit: "60000",
            stopLoss: "55000",
          },
        },
        id: 6,
      }),
    });

    const res = await handler.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const data = JSON.parse(body.result.content[0].text);
    expect(data.retCode).toBe(0);
    expect(data.retMsg).toBe("OK");
  });

  it("returns mock order details for place_bybit_order in sandbox mode", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "place_bybit_order",
          arguments: {
            symbol: "BTCUSDT",
            side: "Buy",
            orderType: "Market",
            qty: "0.1",
          },
        },
        id: 7,
      }),
    });

    const res = await handler.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const data = JSON.parse(body.result.content[0].text);
    expect(data.orderId).toBeDefined();
    expect(data.orderId).toContain("mock-ord");
  });
});
