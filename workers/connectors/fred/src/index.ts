export interface Env {
  ENVIRONMENT: string;
}

interface DecryptedPayload {
  apiKey?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 1. Read vault payload from header
    const vaultHeader = request.headers.get("x-vault-payload");
    let credentials: DecryptedPayload = {};
    if (vaultHeader) {
      try {
        const decoded = atob(vaultHeader);
        credentials = JSON.parse(decoded);
      } catch (err) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32602, message: "Invalid credentials payload header" },
            id: null,
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }
    }

    // 2. Parse JSON-RPC request body
    if (request.method !== "POST") {
      return new Response("Method not allowed. Use POST for JSON-RPC.", { status: 405 });
    }

    let jsonRpcRequest: any;
    try {
      jsonRpcRequest = await request.json();
    } catch (err) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32700, message: "Parse error" },
          id: null,
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    const { method, params, id } = jsonRpcRequest;

    try {
      if (method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            result: {
              tools: [
                {
                  name: "get_fred_series",
                  description: "Retrieve macroeconomic data series observations from FRED (Federal Reserve Economic Data).",
                  inputSchema: {
                    type: "object",
                    properties: {
                      seriesId: {
                        type: "string",
                        description: "FRED series ID, e.g. 'CPIAUCSL' (Consumer Price Index), 'UNRATE' (Unemployment Rate), or 'GDPC1' (Real GDP).",
                      },
                    },
                    required: ["seriesId"],
                  },
                },
              ],
            },
            id,
          }),
          { headers: { "content-type": "application/json" } }
        );
      }

      if (method === "tools/call") {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};

        if (toolName === "get_fred_series") {
          const seriesId = toolArgs.seriesId;
          if (!seriesId) {
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32602, message: "Missing seriesId argument" },
                id,
              }),
              { status: 400, headers: { "content-type": "application/json" } }
            );
          }

          const isSandbox = !credentials.apiKey || credentials.apiKey === "sandbox";
          const data = isSandbox
            ? getMockFredData(seriesId)
            : await callFredApi(credentials.apiKey!, seriesId);

          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(data, null, 2),
                  },
                ],
              },
              id,
            }),
            { headers: { "content-type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32601, message: `Method not found: ${toolName}` },
            id,
          }),
          { status: 404, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ jsonrpc: "2.0", result: {}, id }), {
        headers: { "content-type": "application/json" },
      });
    } catch (err: any) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: err.message || "Internal error" },
          id,
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  },
};

// --- FRED API REST Client ---

async function callFredApi(apiKey: string, seriesId: string): Promise<any> {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId.toUpperCase()}&api_key=${apiKey}&file_type=json&limit=5`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FRED API HTTP error: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

// --- Sandbox Mock Data Generator ---

function getMockFredData(seriesId: string) {
  const sym = seriesId.toUpperCase();
  let observations = [];

  if (sym === "UNRATE") {
    observations = [
      { date: "2026-03-01", value: "3.8" },
      { date: "2026-04-01", value: "3.9" },
      { date: "2026-05-01", value: "4.0" },
      { date: "2026-06-01", value: "4.1" },
    ];
  } else if (sym === "CPIAUCSL") {
    observations = [
      { date: "2026-03-01", value: "312.230" },
      { date: "2026-04-01", value: "313.542" },
      { date: "2026-05-01", value: "314.120" },
      { date: "2026-06-01", value: "314.890" },
    ];
  } else {
    observations = [
      { date: "2026-03-01", value: "100.5" },
      { date: "2026-04-01", value: "101.2" },
      { date: "2026-05-01", value: "101.8" },
      { date: "2026-06-01", value: "102.5" },
    ];
  }

  return {
    realtime_start: "2026-07-08",
    realtime_end: "2026-07-08",
    observation_start: "2026-03-01",
    observation_end: "2026-06-01",
    units: "lin",
    output_type: 1,
    file_type: "json",
    observations,
  };
}
