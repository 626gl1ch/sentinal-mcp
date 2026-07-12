export interface Env {
  ENVIRONMENT: string;
}

// In-memory array for recent alerts (reset on worker cold start)
const recentAlerts: any[] = [
  {
    timestamp: new Date(Date.now() - 300000).toISOString(),
    ticker: "BTCUSDT",
    action: "buy",
    price: 57200.0,
    message: "MA Cross Long Alert",
  },
  {
    timestamp: new Date(Date.now() - 900000).toISOString(),
    ticker: "ETHUSDT",
    action: "sell",
    price: 3120.0,
    message: "RSI Overbought Short Alert",
  },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1. Accept Webhook POSTs directly from TradingView
    if (request.method === "POST" && url.pathname === "/webhook") {
      try {
        const body: any = await request.json();
        
        // Add to in-memory list (capped at 50)
        recentAlerts.unshift({
          timestamp: new Date().toISOString(),
          ...body,
        });
        if (recentAlerts.length > 50) {
          recentAlerts.pop();
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { "content-type": "application/json" },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || "Failed to process alert" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
    }

    // 2. JSON-RPC MCP Interface
    if (request.method !== "POST") {
      return new Response("Method not allowed. Use POST for JSON-RPC / MCP.", { status: 405 });
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
                  name: "get_tradingview_alerts",
                  description: "Retrieve list of recent webhooks/alerts received from TradingView.",
                  inputSchema: {
                    type: "object",
                    properties: {
                      symbol: {
                        type: "string",
                        description: "Optional filter by ticker symbol (e.g. 'BTCUSDT').",
                      },
                    },
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

        if (toolName === "get_tradingview_alerts") {
          let alerts = [...recentAlerts];
          if (toolArgs.symbol) {
            const sym = toolArgs.symbol.toUpperCase();
            alerts = alerts.filter((a) => a.ticker.toUpperCase() === sym);
          }

          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(alerts, null, 2),
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
