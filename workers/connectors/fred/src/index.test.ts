import { describe, it, expect } from "vitest";
import handler from "./index";

describe("FRED Connector Worker", () => {
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
    expect(body.result.tools[0].name).toBe("get_fred_series");
  });

  it("returns sandbox observations on call_tool for get_fred_series", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "get_fred_series",
          arguments: {
            seriesId: "UNRATE",
          },
        },
        id: 2,
      }),
    });

    const res = await handler.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const data = JSON.parse(body.result.content[0].text);
    expect(data.observations.length).toBe(4);
    expect(data.observations[0].value).toBe("3.8");
  });
});
