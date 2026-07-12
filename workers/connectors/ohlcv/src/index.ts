export interface Env {
  ENVIRONMENT: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
                  name: "get_normalized_ohlcv",
                  description: "Retrieve standardized Open-High-Low-Close-Volume candle data for a trading symbol.",
                  inputSchema: {
                    type: "object",
                    properties: {
                      symbol: {
                        type: "string",
                        description: "Symbol to query (e.g. 'BTCUSDT').",
                      },
                      interval: {
                        type: "string",
                        description: "Candle interval, e.g. 1m, 5m, 15m, 1h, 1d (default: 5m).",
                      },
                      limit: {
                        type: "integer",
                        description: "Number of candles to retrieve (default: 10, max: 100).",
                      },
                    },
                    required: ["symbol"],
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

        if (toolName === "get_normalized_ohlcv") {
          const symbol = toolArgs.symbol;
          if (!symbol) {
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32602, message: "Missing symbol argument" },
                id,
              }),
              { status: 400, headers: { "content-type": "application/json" } }
            );
          }

          const interval = toolArgs.interval || "5m";
          const limit = Math.min(toolArgs.limit || 10, 100);

          const candles = generateMockCandles(symbol, interval, limit);

          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(candles, null, 2),
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

// --- Mock Candle Generator ---

function generateMockCandles(symbol: string, interval: string, limit: number) {
  const candles = [];
  const now = Date.now();
  let intervalMs = 300000; // 5m default

  if (interval === "1m") intervalMs = 60000;
  else if (interval === "5m") intervalMs = 300000;
  else if (interval === "15m") intervalMs = 900000;
  else if (interval === "1h") intervalMs = 3600000;
  else if (interval === "1d") intervalMs = 86400000;

  const basePrice = symbol.toUpperCase().startsWith("BTC") ? 57000.0 : 3100.0;

  for (let i = limit - 1; i >= 0; i--) {
    const time = now - i * intervalMs;
    const rnd = Math.sin(i) * 15.0; // deterministic random path
    const open = basePrice + rnd;
    const close = open + (Math.cos(i) * 8.0);
    const high = Math.max(open, close) + 5.0;
    const low = Math.min(open, close) - 5.0;
    const volume = Math.round(100.0 + Math.abs(Math.sin(i) * 900.0));

    candles.push({
      timestamp: new Date(time).toISOString(),
      open,
      high,
      low,
      close,
      volume,
    });
  }

  return {
    symbol: symbol.toUpperCase(),
    interval,
    candles,
  };
}
