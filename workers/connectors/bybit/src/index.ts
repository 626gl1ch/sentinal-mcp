export interface Env {
  ENVIRONMENT: string;
}

interface DecryptedPayload {
  apiKey?: string;
  apiSecret?: string;
  useTestnet?: boolean;
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
                  name: "get_bybit_account_info",
                  description: "Retrieve Bybit wallet balances for the account (Unified or Contract).",
                  inputSchema: {
                    type: "object",
                    properties: {
                      accountType: {
                        type: "string",
                        description: "Bybit account type, e.g. UNIFIED (default) or CONTRACT.",
                      },
                    },
                  },
                },
                {
                  name: "get_bybit_positions",
                  description: "Retrieve open positions on Bybit.",
                  inputSchema: {
                    type: "object",
                    properties: {
                      symbol: {
                        type: "string",
                        description: "Optional filter by symbol (e.g. 'BTCUSDT').",
                      },
                      category: {
                        type: "string",
                        description: "Product category: linear (default), inverse, or option.",
                      },
                    },
                  },
                },
                {
                  name: "get_bybit_orders",
                  description: "Retrieve recent order history on Bybit.",
                  inputSchema: {
                    type: "object",
                    properties: {
                      symbol: {
                        type: "string",
                        description: "Optional filter by symbol (e.g. 'BTCUSDT').",
                      },
                      category: {
                        type: "string",
                        description: "Product category: linear (default), inverse, spot, or option.",
                      },
                      limit: {
                        type: "integer",
                        description: "Number of orders to retrieve (default: 20, max: 50).",
                      },
                    },
                  },
                },
                {
                  name: "set_bybit_tp_sl",
                  description: "Set Take Profit and/or Stop Loss for an active position on Bybit.",
                  inputSchema: {
                    type: "object",
                    properties: {
                      symbol: {
                        type: "string",
                        description: "Trading symbol, e.g. 'BTCUSDT'.",
                      },
                      category: {
                        type: "string",
                        description: "Product category: linear (default), inverse, or option.",
                      },
                      takeProfit: {
                        type: "string",
                        description: "Take profit price. Omit or set to '0' to cancel.",
                      },
                      stopLoss: {
                        type: "string",
                        description: "Stop loss price. Omit or set to '0' to cancel.",
                      },
                      positionIdx: {
                        type: "integer",
                        description: "Position index: 0 for one-way, 1 for buy side, 2 for sell side. Default: 0.",
                      },
                    },
                    required: ["symbol"],
                  },
                },
                {
                  name: "place_bybit_order",
                  description: "Place a new order on Bybit (market, limit, etc.) for entry or exit.",
                  inputSchema: {
                    type: "object",
                    properties: {
                      symbol: {
                        type: "string",
                        description: "Trading symbol, e.g. 'BTCUSDT'.",
                      },
                      category: {
                        type: "string",
                        description: "Product category: linear (default), inverse, spot, or option.",
                      },
                      side: {
                        type: "string",
                        description: "Buy or Sell.",
                      },
                      orderType: {
                        type: "string",
                        description: "Market or Limit.",
                      },
                      qty: {
                        type: "string",
                        description: "Order quantity.",
                      },
                      price: {
                        type: "string",
                        description: "Order price (required for Limit orders).",
                      },
                      timeInForce: {
                        type: "string",
                        description: "GTC, IOC, FOK, PostOnly. Default: GTC.",
                      },
                      reduceOnly: {
                        type: "boolean",
                        description: "If true, the order will only reduce the position.",
                      },
                    },
                    required: ["symbol", "side", "orderType", "qty"],
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

        const isSandbox = !credentials.apiKey || !credentials.apiSecret || credentials.apiKey === "sandbox";

        if (toolName === "get_bybit_account_info") {
          const accountType = toolArgs.accountType || "UNIFIED";
          const data = isSandbox
            ? getMockAccountInfo(accountType)
            : await callBybitApi(credentials, "GET", "/v5/account/wallet-balance", `accountType=${accountType}`);

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

        if (toolName === "get_bybit_positions") {
          const category = toolArgs.category || "linear";
          const symbol = toolArgs.symbol;
          let queryParams = `category=${category}`;
          if (symbol) {
            queryParams += `&symbol=${symbol.toUpperCase()}`;
          }

          let data = isSandbox
            ? getMockPositions(category, symbol)
            : await callBybitApi(credentials, "GET", "/v5/position/list", queryParams);

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

        if (toolName === "get_bybit_orders") {
          const category = toolArgs.category || "linear";
          const symbol = toolArgs.symbol;
          const limit = toolArgs.limit || 20;
          let queryParams = `category=${category}&limit=${limit}`;
          if (symbol) {
            queryParams += `&symbol=${symbol.toUpperCase()}`;
          }

          let data = isSandbox
            ? getMockOrders(category, symbol, limit)
            : await callBybitApi(credentials, "GET", "/v5/order/history", queryParams);

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

        if (toolName === "set_bybit_tp_sl") {
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

          const category = toolArgs.category || "linear";
          const takeProfit = toolArgs.takeProfit;
          const stopLoss = toolArgs.stopLoss;
          const positionIdx = toolArgs.positionIdx !== undefined ? toolArgs.positionIdx : 0;

          let data: any;
          if (isSandbox) {
            data = {
              retCode: 0,
              retMsg: "OK",
              result: {},
              retExtInfo: {},
              time: Date.now()
            };
          } else {
            const body = {
              category,
              symbol: symbol.toUpperCase(),
              takeProfit,
              stopLoss,
              positionIdx
            };
            data = await callBybitApi(credentials, "POST", "/v5/position/set-tp-sl", JSON.stringify(body));
          }

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

        if (toolName === "place_bybit_order") {
          const symbol = toolArgs.symbol;
          const side = toolArgs.side;
          const orderType = toolArgs.orderType;
          const qty = toolArgs.qty;

          if (!symbol || !side || !orderType || !qty) {
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32602, message: "Missing required arguments" },
                id,
              }),
              { status: 400, headers: { "content-type": "application/json" } }
            );
          }

          const category = toolArgs.category || "linear";
          const price = toolArgs.price;
          const timeInForce = toolArgs.timeInForce || "GTC";
          const reduceOnly = !!toolArgs.reduceOnly;

          let data: any;
          if (isSandbox) {
            data = {
              orderId: "mock-ord-" + Math.floor(Math.random() * 1000000),
              orderLinkId: ""
            };
          } else {
            const body = {
              category,
              symbol: symbol.toUpperCase(),
              side,
              orderType,
              qty,
              price,
              timeInForce,
              reduceOnly
            };
            data = await callBybitApi(credentials, "POST", "/v5/order/create", JSON.stringify(body));
          }

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

      // Fallback for standard JSON-RPC requests
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

// --- Bybit Authentication & REST Client ---

async function callBybitApi(
  credentials: DecryptedPayload,
  method: "GET" | "POST",
  path: string,
  queryOrBody: string
): Promise<any> {
  const host = credentials.useTestnet ? "api-testnet.bybit.com" : "api.bybit.com";
  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const apiKey = credentials.apiKey || "";
  const apiSecret = credentials.apiSecret || "";

  const signature = await generateBybitSignature(
    apiSecret,
    timestamp,
    apiKey,
    recvWindow,
    queryOrBody
  );

  let url = `https://${host}${path}`;
  let options: RequestInit = {
    method,
    headers: {
      "X-BAPI-API-KEY": apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": recvWindow,
      "X-BAPI-SIGN": signature,
      "Content-Type": "application/json",
    },
  };

  if (method === "GET") {
    if (queryOrBody) {
      url += `?${queryOrBody}`;
    }
  } else {
    options.body = queryOrBody;
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`Bybit API HTTP error: ${res.status} ${res.statusText}`);
  }

  const result: any = await res.json();
  if (result.retCode !== 0) {
    throw new Error(`Bybit API error: [${result.retCode}] ${result.retMsg}`);
  }

  return result.result;
}

// HMAC-SHA256 signature generator using Web Crypto
async function generateBybitSignature(
  secret: string,
  timestamp: string,
  apiKey: string,
  recvWindow: string,
  queryOrBody: string
): Promise<string> {
  const encoder = new TextEncoder();
  const dataStr = timestamp + apiKey + recvWindow + queryOrBody;

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(dataStr)
  );

  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- Sandbox Mock Data Generators ---

function getMockAccountInfo(accountType: string) {
  return {
    list: [
      {
        totalEquity: "25120.50",
        totalWalletBalance: "25000.00",
        totalMarginBalance: "25120.50",
        totalAvailableBalance: "24820.50",
        coin: [
          {
            coin: "USDT",
            equity: "15120.50",
            usdValue: "15120.50",
            walletBalance: "15000.00",
            availableToWithdraw: "14820.50",
          },
          {
            coin: "USDC",
            equity: "10000.00",
            usdValue: "10000.00",
            walletBalance: "10000.00",
            availableToWithdraw: "10000.00",
          },
        ],
      },
    ],
  };
}

function getMockPositions(category: string, symbol?: string) {
  const allMockPositions = [
    {
      symbol: "BTCUSDT",
      side: "Buy",
      size: "0.500",
      entryPrice: "57000.00",
      markPrice: "57340.00",
      leverage: "10",
      positionValue: "28670.00",
      unrealisedPnl: "170.00",
      positionIM: "2867.00",
      positionStatus: "Normal",
      createdTime: "1720448102000",
    },
    {
      symbol: "ETHUSDT",
      side: "Sell",
      size: "5.00",
      entryPrice: "3100.00",
      markPrice: "3080.00",
      leverage: "10",
      positionValue: "15400.00",
      unrealisedPnl: "100.00",
      positionIM: "1540.00",
      positionStatus: "Normal",
      createdTime: "1720449102000",
    },
  ];

  if (symbol) {
    const sym = symbol.toUpperCase();
    return {
      category,
      list: allMockPositions.filter((p) => p.symbol === sym),
    };
  }

  return {
    category,
    list: allMockPositions,
  };
}

function getMockOrders(category: string, symbol?: string, limit: number = 20) {
  const allMockOrders = [
    {
      orderId: "ord-998877",
      symbol: "BTCUSDT",
      side: "Buy",
      orderType: "Limit",
      price: "57000.00",
      qty: "0.500",
      orderStatus: "Filled",
      cumExecQty: "0.500",
      cumExecValue: "28500.00",
      createdTime: "1720448100000",
      updatedTime: "1720448102000",
    },
    {
      orderId: "ord-998878",
      symbol: "ETHUSDT",
      side: "Sell",
      orderType: "Limit",
      price: "3150.00",
      qty: "5.00",
      orderStatus: "Cancelled",
      cumExecQty: "0.00",
      cumExecValue: "0.00",
      createdTime: "1720448200000",
      updatedTime: "1720448210000",
    },
  ];

  let filtered = allMockOrders;
  if (symbol) {
    const sym = symbol.toUpperCase();
    filtered = filtered.filter((o) => o.symbol === sym);
  }

  return {
    category,
    list: filtered.slice(0, limit),
  };
}
