export interface Env {
  ENVIRONMENT: string;
}

interface DecryptedPayload {
  bridgeUrl?: string;
  bridgeToken?: string;
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
                  name: "get_mt5_account_info",
                  description: "Retrieve MT5 trading account summary (balance, equity, free margin, leverage, company).",
                  inputSchema: {
                    type: "object",
                    properties: {},
                  },
                },
                {
                  name: "get_mt5_positions",
                  description: "Retrieve list of all active open trading positions in MetaTrader 5.",
                  inputSchema: {
                    type: "object",
                    properties: {
                      symbol: {
                        type: "string",
                        description: "Optional filter by symbol (e.g. 'EURUSD').",
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

        if (toolName === "get_mt5_account_info") {
          const accountInfo = await fetchAccountInfo(credentials);
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(accountInfo, null, 2),
                  },
                ],
              },
              id,
            }),
            { headers: { "content-type": "application/json" } }
          );
        }

        if (toolName === "get_mt5_positions") {
          let positions = await fetchPositions(credentials);
          if (toolArgs.symbol) {
            const sym = toolArgs.symbol.toUpperCase();
            positions = positions.filter((p: any) => p.symbol.toUpperCase() === sym);
          }
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(positions, null, 2),
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

      // Fallback for other standard JSON-RPC endpoints (e.g. resources, prompts)
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          result: {},
          id,
        }),
        { headers: { "content-type": "application/json" } }
      );
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

// --- Helper functions for fetching MT5 data ---

async function fetchAccountInfo(credentials: DecryptedPayload): Promise<any> {
  // If bridgeUrl is missing or set to sandbox, return mock sandbox data
  if (!credentials.bridgeUrl || credentials.bridgeUrl === "sandbox") {
    return {
      login: 12345678,
      name: "John Doe Sandbox",
      server: "MetaQuotes-Demo",
      company: "MetaQuotes Software Corp.",
      currency: "USD",
      balance: 10000.0,
      equity: 10022.0,
      margin: 150.0,
      margin_free: 9872.0,
      margin_level: 6681.3,
      leverage: 100,
    };
  }

  // Live call to the HTTP bridge
  try {
    const url = `${credentials.bridgeUrl}/account`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (credentials.bridgeToken) {
      headers["Authorization"] = `Bearer ${credentials.bridgeToken}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`MT5 Bridge HTTP error: ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } catch (err: any) {
    throw new Error(`Failed to contact MT5 HTTP Bridge: ${err.message}`);
  }
}

async function fetchPositions(credentials: DecryptedPayload): Promise<any[]> {
  if (!credentials.bridgeUrl || credentials.bridgeUrl === "sandbox") {
    return [
      {
        ticket: 10000001,
        symbol: "EURUSD",
        type: "BUY",
        volume: 0.1,
        openPrice: 1.085,
        currentPrice: 1.0872,
        profit: 22.0,
        comment: "sandbox-demo",
      },
      {
        ticket: 10000002,
        symbol: "GBPUSD",
        type: "SELL",
        volume: 0.05,
        openPrice: 1.275,
        currentPrice: 1.2735,
        profit: 7.5,
        comment: "sandbox-demo",
      },
    ];
  }

  try {
    const url = `${credentials.bridgeUrl}/positions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (credentials.bridgeToken) {
      headers["Authorization"] = `Bearer ${credentials.bridgeToken}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`MT5 Bridge HTTP error: ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } catch (err: any) {
    throw new Error(`Failed to contact MT5 HTTP Bridge: ${err.message}`);
  }
}
