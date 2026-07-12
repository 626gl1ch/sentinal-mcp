export interface Env {
  ENVIRONMENT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  VAULT_ENCRYPTION_KEY?: string;
  BYBIT_CONNECTOR: { fetch: typeof fetch };
}

interface DecryptedPayload {
  apiKey?: string;
  apiSecret?: string;
  useTestnet?: boolean;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // 1. TradingView Webhook Alerts
    if (request.method === "POST" && path === "/webhook/tradingview") {
      try {
        const body: any = await request.json();
        const { ticker, timeframe, type, direction } = body;

        if (!ticker || !type) {
          return new Response(JSON.stringify({ error: "Missing ticker or type" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const symbol = ticker.toUpperCase();

        // Retrieve target user_id (either by optional key param or all registered users with presets)
        let userIds: string[] = [];
        const keyParam = url.searchParams.get("key");
        if (keyParam) {
          const hashedKey = await sha256Hex(keyParam);
          const keyRes = await supabaseFetch(
            env,
            `/rest/v1/api_keys?key_hash=eq.${hashedKey}&select=user_id,revoked`
          );
          if (keyRes && keyRes.length > 0 && !keyRes[0].revoked) {
            userIds.push(keyRes[0].user_id);
          }
        } else {
          // Broad alert: find all users with presets for this symbol
          const presetRes = await supabaseFetch(
            env,
            `/rest/v1/trading_presets?symbol=eq.${symbol}&select=user_id`
          );
          if (presetRes) {
            userIds = presetRes.map((p: any) => p.user_id);
          }
        }

        // Process state transition for each user
        for (const userId of userIds) {
          await processAlertTransition(env, userId, symbol, timeframe, type, direction);
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || "Failed to process alert" }), {
          status: 500,
          headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    // 2. Telegram Webhook Updates
    if (request.method === "POST" && path === "/webhook") {
      try {
        const update: any = await request.json();
        const message = update.message;

        if (!message || !message.text) {
          return new Response("OK", { status: 200 });
        }

        const chat_id = message.chat.id.toString();
        const text = message.text.trim();

        // Route commands
        if (text.startsWith("/start")) {
          await handleStartCommand(env, chat_id);
        } else if (text.startsWith("/register")) {
          await handleRegisterCommand(env, chat_id, text);
        } else {
          // Verify registration
          const settings = await supabaseFetch(
            env,
            `/rest/v1/telegram_settings?telegram_chat_id=eq.${chat_id}&select=user_id`
          );

          if (!settings || settings.length === 0) {
            await sendTelegramMessage(
              env,
              chat_id,
              "⚠️ Your chat is not registered. Please register first with:\n<code>/register &lt;your_dashboard_api_key&gt;</code>"
            );
            return new Response("OK", { status: 200 });
          }

          const userId = settings[0].user_id;

          if (text.startsWith("/preset")) {
            await handlePresetCommand(env, chat_id, userId, text);
          } else if (text.startsWith("/presets")) {
            await handlePresetsCommand(env, chat_id, userId);
          } else if (text.startsWith("/bias")) {
            await handleBiasCommand(env, chat_id, userId, text);
          } else if (text.startsWith("/setup")) {
            await handleSetupCommand(env, chat_id, userId, text);
          } else if (text.startsWith("/entry")) {
            await handleEntryCommand(env, chat_id, userId, text);
          } else if (text.startsWith("/status")) {
            await handleStatusCommand(env, chat_id, userId, text);
          } else if (text.startsWith("/exit")) {
            await handleExitCommand(env, chat_id, userId, text);
          } else {
            await sendTelegramMessage(
              env,
              chat_id,
              "❓ Unknown command. Available commands:\n" +
                "/presets - List all active presets\n" +
                "/preset [symbol] [tp%] [strategy] - Set a symbol preset\n" +
                "/bias [symbol] [long/short] - Manually set BIAS\n" +
                "/status [symbol] - Check position and bot status\n" +
                "/exit [symbol] - Execute market exit on exchange"
            );
          }
        }

        return new Response("OK", { status: 200 });
      } catch (err: any) {
        console.error("Telegram webhook error", err);
        return new Response("OK", { status: 200 }); // Always return 200 to Telegram
      }
    }

    return new Response("Not found", { status: 404 });
  },

  // 3. Cron Scheduler: Checks positions and state expirations every minute
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      // Find all active states that are not IDLE
      const activeStates = await supabaseFetch(
        env,
        `/rest/v1/trading_states?state=neq.IDLE&select=user_id,symbol,state,bias_direction,bias_timestamp,setup_timestamp,position_taken_over`
      );

      if (!activeStates || activeStates.length === 0) return;

      const now = Date.now();
      const biasExpirationMs = 2 * 60 * 60 * 1000; // 2 hours
      const setupExpirationMs = 1 * 60 * 60 * 1000; // 1 hour

      for (const record of activeStates) {
        const { user_id, symbol, state, bias_direction, bias_timestamp, setup_timestamp, position_taken_over } = record;

        // Fetch Telegram Chat ID for notifications
        const settings = await supabaseFetch(
          env,
          `/rest/v1/telegram_settings?user_id=eq.${user_id}&select=telegram_chat_id`
        );
        const chat_id = settings && settings.length > 0 ? settings[0].telegram_chat_id : null;

        // A. Expiration Checks
        if (state === "BIAS_ESTABLISHED" && bias_timestamp) {
          const elapsed = now - new Date(bias_timestamp).getTime();
          if (elapsed > biasExpirationMs) {
            await supabasePatch(
              env,
              `/rest/v1/trading_states?user_id=eq.${user_id}&symbol=eq.${symbol}`,
              { state: "IDLE", bias_direction: "NONE", updated_at: new Date().toISOString() }
            );
            if (chat_id) {
              await sendTelegramMessage(
                env,
                chat_id,
                `⏳ <b>[${symbol}]</b> BIAS (LONG/SHORT) has expired. State reset to IDLE.`
              );
            }
            continue;
          }
        }

        if (state === "SETUP_ESTABLISHED" && setup_timestamp) {
          const elapsed = now - new Date(setup_timestamp).getTime();
          if (elapsed > setupExpirationMs) {
            await supabasePatch(
              env,
              `/rest/v1/trading_states?user_id=eq.${user_id}&symbol=eq.${symbol}`,
              { state: "IDLE", bias_direction: "NONE", updated_at: new Date().toISOString() }
            );
            if (chat_id) {
              await sendTelegramMessage(
                env,
                chat_id,
                `⏳ <b>[${symbol}]</b> SETUP has expired. State reset to IDLE.`
              );
            }
            continue;
          }
        }

        // B. Position Monitoring
        // Query Bybit for active positions
        try {
          const positionRes = await callBybitConnector(env, user_id, "get_bybit_positions", { symbol });
          const position = positionRes.list && positionRes.list.length > 0 ? positionRes.list[0] : null;
          const hasPosition = position && parseFloat(position.size) > 0;

          if (state === "MANAGING_POSITION") {
            if (!hasPosition) {
              // Position was closed on exchange (e.g. TP/SL hit or manually closed)
              await supabasePatch(
                env,
                `/rest/v1/trading_states?user_id=eq.${user_id}&symbol=eq.${symbol}`,
                {
                  state: "IDLE",
                  bias_direction: "NONE",
                  position_taken_over: false,
                  entry_price: null,
                  updated_at: new Date().toISOString(),
                }
              );
              if (chat_id) {
                await sendTelegramMessage(
                  env,
                  chat_id,
                  `🏁 <b>[${symbol}]</b> Position closed on exchange. State reset to IDLE.`
                );
              }
            } else {
              // Trailing Stop logic
              const presets = await supabaseFetch(
                env,
                `/rest/v1/trading_presets?user_id=eq.${user_id}&symbol=eq.${symbol}&select=exit_strategy,trailing_stop_pct`
              );
              if (presets && presets.length > 0 && presets[0].exit_strategy === "trailing_stop") {
                const tsPct = parseFloat(presets[0].trailing_stop_pct || "1.0");
                const markPrice = parseFloat(position.markPrice);
                const currentSl = parseFloat(position.stopLoss || "0");
                const side = position.side; // Buy or Sell

                let newSl = 0;
                let shouldUpdate = false;

                if (side === "Buy") {
                  newSl = markPrice * (1 - tsPct / 100);
                  if (currentSl === 0 || newSl > currentSl) {
                    shouldUpdate = true;
                  }
                } else if (side === "Sell") {
                  newSl = markPrice * (1 + tsPct / 100);
                  if (currentSl === 0 || newSl < currentSl) {
                    shouldUpdate = true;
                  }
                }

                if (shouldUpdate && newSl > 0) {
                  // Call set_bybit_tp_sl to adjust stop loss
                  await callBybitConnector(env, user_id, "set_bybit_tp_sl", {
                    symbol,
                    stopLoss: newSl.toFixed(2),
                  });
                  if (chat_id) {
                    await sendTelegramMessage(
                      env,
                      chat_id,
                      `📈 <b>[${symbol}]</b> Trailing Stop Loss updated to <code>${newSl.toFixed(2)}</code> (Mark: ${markPrice}).`
                    );
                  }
                }
              }
            }
          } else if (state === "SETUP_ESTABLISHED" || state === "BIAS_ESTABLISHED") {
            // Check if user has entered a trade and the bot can take it over
            if (hasPosition) {
              const entryPrice = parseFloat(position.entryPrice);
              const side = position.side; // Buy or Sell

              // Get preset configs
              const presets = await supabaseFetch(
                env,
                `/rest/v1/trading_presets?user_id=eq.${user_id}&symbol=eq.${symbol}&select=tp_distance_pct,exit_strategy`
              );

              const tpPct = presets && presets.length > 0 ? parseFloat(presets[0].tp_distance_pct) : 1.0;
              const strategy = presets && presets.length > 0 ? presets[0].exit_strategy : "fixed_tp";

              let tpPrice = 0;
              if (side === "Buy") {
                tpPrice = entryPrice * (1 + tpPct / 100);
              } else {
                tpPrice = entryPrice * (1 - tpPct / 100);
              }

              // Update State
              await supabasePatch(
                env,
                `/rest/v1/trading_states?user_id=eq.${user_id}&symbol=eq.${symbol}`,
                {
                  state: "MANAGING_POSITION",
                  position_taken_over: true,
                  entry_price: entryPrice,
                  updated_at: new Date().toISOString(),
                }
              );

              // Set Take Profit on the exchange if strategy is fixed_tp or trailing_stop
              if (strategy === "fixed_tp" || strategy === "trailing_stop") {
                await callBybitConnector(env, user_id, "set_bybit_tp_sl", {
                  symbol,
                  takeProfit: tpPrice.toFixed(2),
                });
              }

              if (chat_id) {
                await sendTelegramMessage(
                  env,
                  chat_id,
                  `🤝 <b>[${symbol}]</b> Active position detected on exchange! Bot has taken over.\n` +
                    `• Side: <b>${side}</b>\n` +
                    `• Entry Price: <code>${entryPrice}</code>\n` +
                    `• Strategy: <code>${strategy.toUpperCase()}</code>\n` +
                    `• Take Profit set to: <code>${tpPrice.toFixed(2)}</code>`
                );
              }
            }
          }
        } catch (e: any) {
          console.error(`Scheduled position check failed for ${symbol}: ${e.message}`);
        }
      }
    } catch (err: any) {
      console.error("Scheduled cron error", err);
    }
  },
};

// --- Command Handlers ---

async function handleStartCommand(env: Env, chat_id: string) {
  const welcomeText =
    "🤖 <b>Welcome to Bastion Bybit Position Manager!</b>\n\n" +
    "This bot helps you manage your active Bybit positions based on stateful trigger processes.\n\n" +
    "To begin, link your account by typing:\n" +
    "<code>/register &lt;your_bastion_api_key&gt;</code>\n\n" +
    "Generate an API key on the Bastion web dashboard first.";
  await sendTelegramMessage(env, chat_id, welcomeText);
}

async function handleRegisterCommand(env: Env, chat_id: string, text: string) {
  const parts = text.split(" ");
  if (parts.length < 2) {
    await sendTelegramMessage(
      env,
      chat_id,
      "⚠️ Formatting error. Use:\n<code>/register &lt;your_bastion_api_key&gt;</code>"
    );
    return;
  }

  const rawKey = parts[1].trim();
  if (!rawKey.startsWith("bm_")) {
    await sendTelegramMessage(env, chat_id, "⚠️ Invalid key format. Bastion API keys start with 'bm_'.");
    return;
  }

  const hashedKey = await sha256Hex(rawKey);

  // Validate API key against Supabase
  const keyRes = await supabaseFetch(
    env,
    `/rest/v1/api_keys?key_hash=eq.${hashedKey}&select=user_id,revoked`
  );

  if (!keyRes || keyRes.length === 0 || keyRes[0].revoked) {
    await sendTelegramMessage(env, chat_id, "❌ Registration failed: Invalid or revoked API key.");
    return;
  }

  const userId = keyRes[0].user_id;

  // Save to telegram_settings
  await supabaseWrite(
    env,
    "/rest/v1/telegram_settings",
    {
      user_id: userId,
      telegram_chat_id: chat_id,
      updated_at: new Date().toISOString(),
    },
    { Prefer: "resolution=merge-duplicates" }
  );

  await sendTelegramMessage(
    env,
    chat_id,
    "✅ <b>Registration Successful!</b>\n\n" +
      "Your Telegram account is now linked. You can configure presets and manage positions.\n\n" +
      "Type /presets to get started."
  );
}

async function handlePresetCommand(env: Env, chat_id: string, userId: string, text: string) {
  // Format: /preset [symbol] [tp_distance_pct] [strategy] [trailing_stop_pct]
  const parts = text.split(" ").filter(Boolean);
  if (parts.length < 4) {
    await sendTelegramMessage(
      env,
      chat_id,
      "⚠️ Formatting error. Use:\n<code>/preset &lt;symbol&gt; &lt;tp_distance_pct&gt; &lt;strategy&gt; [&lt;trailing_stop_pct&gt;]</code>\n\n" +
        "Examples:\n" +
        "• <code>/preset BTCUSDT 1.5 fixed_tp</code>\n" +
        "• <code>/preset ETHUSDT 2.0 trailing_stop 0.5</code>\n" +
        "• <code>/preset SOLUSDT 1.2 contrary_signal</code>"
    );
    return;
  }

  const symbol = parts[1].toUpperCase();
  const tpPct = parseFloat(parts[2]);
  const strategy = parts[3].toLowerCase();
  const trailingStopPct = parts[4] ? parseFloat(parts[4]) : null;

  if (isNaN(tpPct) || tpPct <= 0) {
    await sendTelegramMessage(env, chat_id, "⚠️ TP Distance % must be a positive number.");
    return;
  }

  if (strategy !== "fixed_tp" && strategy !== "trailing_stop" && strategy !== "contrary_signal") {
    await sendTelegramMessage(
      env,
      chat_id,
      "⚠️ Exit strategy must be one of: <code>fixed_tp</code>, <code>trailing_stop</code>, <code>contrary_signal</code>"
    );
    return;
  }

  if (strategy === "trailing_stop" && (!trailingStopPct || isNaN(trailingStopPct) || trailingStopPct <= 0)) {
    await sendTelegramMessage(env, chat_id, "⚠️ Trailing Stop % is required and must be a positive number for trailing_stop strategy.");
    return;
  }

  // Save to database
  await supabaseWrite(
    env,
    "/rest/v1/trading_presets",
    {
      user_id: userId,
      symbol,
      tp_distance_pct: tpPct,
      exit_strategy: strategy,
      trailing_stop_pct: trailingStopPct,
      updated_at: new Date().toISOString(),
    },
    { Prefer: "resolution=merge-duplicates" }
  );

  await sendTelegramMessage(
    env,
    chat_id,
    `💾 <b>Preset Saved for ${symbol}</b>\n` +
      `• TP Target: <code>${tpPct}%</code>\n` +
      `• Exit Strategy: <code>${strategy.toUpperCase()}</code>\n` +
      (trailingStopPct ? `• Trailing Distance: <code>${trailingStopPct}%</code>\n` : "")
  );
}

async function handlePresetsCommand(env: Env, chat_id: string, userId: string) {
  const presets = await supabaseFetch(
    env,
    `/rest/v1/trading_presets?user_id=eq.${userId}&select=symbol,tp_distance_pct,exit_strategy,trailing_stop_pct`
  );

  if (!presets || presets.length === 0) {
    await sendTelegramMessage(env, chat_id, "📭 No active presets found. Set one with /preset.");
    return;
  }

  let text = "📋 <b>Active Presets:</b>\n\n";
  presets.forEach((p: any) => {
    text +=
      `• <b>${p.symbol}</b>:\n` +
      `  - TP: <code>${p.tp_distance_pct}%</code>\n` +
      `  - Strategy: <code>${p.exit_strategy.toUpperCase()}</code>\n` +
      (p.trailing_stop_pct ? `  - Trailing: <code>${p.trailing_stop_pct}%</code>\n` : "\n");
  });

  await sendTelegramMessage(env, chat_id, text);
}

async function handleBiasCommand(env: Env, chat_id: string, userId: string, text: string) {
  // Format: /bias [symbol] [long/short]
  const parts = text.split(" ").filter(Boolean);
  if (parts.length < 3) {
    await sendTelegramMessage(env, chat_id, "⚠️ Formatting error. Use: <code>/bias &lt;symbol&gt; &lt;long/short&gt;</code>");
    return;
  }

  const symbol = parts[1].toUpperCase();
  const dir = parts[2].toUpperCase();

  if (dir !== "LONG" && dir !== "SHORT" && dir !== "NONE") {
    await sendTelegramMessage(env, chat_id, "⚠️ Bias direction must be LONG, SHORT, or NONE.");
    return;
  }

  await supabaseWrite(
    env,
    "/rest/v1/trading_states",
    {
      user_id: userId,
      symbol,
      state: dir === "NONE" ? "IDLE" : "BIAS_ESTABLISHED",
      bias_direction: dir,
      bias_timestamp: dir === "NONE" ? null : new Date().toISOString(),
      setup_timestamp: null,
      entry_timestamp: null,
      updated_at: new Date().toISOString(),
    },
    { Prefer: "resolution=merge-duplicates" }
  );

  await sendTelegramMessage(
    env,
    chat_id,
    dir === "NONE"
      ? `⏹️ Bias reset for <b>${symbol}</b>. State is IDLE.`
      : `📈 <b>[${symbol}]</b> BIAS established as <b>${dir}</b>. Waiting for SETUP.`
  );
}

async function handleSetupCommand(env: Env, chat_id: string, userId: string, text: string) {
  const parts = text.split(" ").filter(Boolean);
  if (parts.length < 3) {
    await sendTelegramMessage(env, chat_id, "⚠️ Formatting error. Use: <code>/setup &lt;symbol&gt; &lt;long/short&gt;</code>");
    return;
  }

  const symbol = parts[1].toUpperCase();
  const dir = parts[2].toUpperCase();

  // Validate state
  const stateRes = await supabaseFetch(
    env,
    `/rest/v1/trading_states?user_id=eq.${userId}&symbol=eq.${symbol}&select=state,bias_direction`
  );

  if (!stateRes || stateRes.length === 0 || stateRes[0].state !== "BIAS_ESTABLISHED" || stateRes[0].bias_direction !== dir) {
    await sendTelegramMessage(
      env,
      chat_id,
      `⚠️ Cannot trigger SETUP. You must establish a <b>${dir}</b> BIAS first.`
    );
    return;
  }

  await supabasePatch(
    env,
    `/rest/v1/trading_states?user_id=eq.${userId}&symbol=eq.${symbol}`,
    {
      state: "SETUP_ESTABLISHED",
      setup_timestamp: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  );

  await sendTelegramMessage(
    env,
    chat_id,
    `🔍 <b>[${symbol}]</b> 5m SETUP confirmed for <b>${dir}</b>. Waiting for ENTRY.`
  );
}

async function handleEntryCommand(env: Env, chat_id: string, userId: string, text: string) {
  const parts = text.split(" ").filter(Boolean);
  if (parts.length < 3) {
    await sendTelegramMessage(env, chat_id, "⚠️ Formatting error. Use: <code>/entry &lt;symbol&gt; &lt;long/short&gt;</code>");
    return;
  }

  const symbol = parts[1].toUpperCase();
  const dir = parts[2].toUpperCase();

  const stateRes = await supabaseFetch(
    env,
    `/rest/v1/trading_states?user_id=eq.${userId}&symbol=eq.${symbol}&select=state,bias_direction`
  );

  if (!stateRes || stateRes.length === 0 || stateRes[0].state !== "SETUP_ESTABLISHED" || stateRes[0].bias_direction !== dir) {
    await sendTelegramMessage(
      env,
      chat_id,
      `⚠️ Cannot trigger ENTRY. You must establish a <b>${dir}</b> SETUP first.`
    );
    return;
  }

  // Trigger Entry
  await supabasePatch(
    env,
    `/rest/v1/trading_states?user_id=eq.${userId}&symbol=eq.${symbol}`,
    {
      entry_timestamp: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  );

  await sendTelegramMessage(
    env,
    chat_id,
    `🚨 <b>[${symbol}]</b> 1m ENTRY SIGNAL TRIGGERED for <b>${dir}</b>!\nChecking for active position on exchange...`
  );

  // Check positions on Bybit immediately
  const positionRes = await callBybitConnector(env, userId, "get_bybit_positions", { symbol });
  const position = positionRes.list && positionRes.list.length > 0 ? positionRes.list[0] : null;

  if (position && parseFloat(position.size) > 0) {
    const entryPrice = parseFloat(position.entryPrice);
    const side = position.side;

    const presets = await supabaseFetch(
      env,
      `/rest/v1/trading_presets?user_id=eq.${userId}&symbol=eq.${symbol}&select=tp_distance_pct,exit_strategy`
    );

    const tpPct = presets && presets.length > 0 ? parseFloat(presets[0].tp_distance_pct) : 1.0;
    const strategy = presets && presets.length > 0 ? presets[0].exit_strategy : "fixed_tp";

    let tpPrice = 0;
    if (side === "Buy") {
      tpPrice = entryPrice * (1 + tpPct / 100);
    } else {
      tpPrice = entryPrice * (1 - tpPct / 100);
    }

    await supabasePatch(
      env,
      `/rest/v1/trading_states?user_id=eq.${userId}&symbol=eq.${symbol}`,
      {
        state: "MANAGING_POSITION",
        position_taken_over: true,
        entry_price: entryPrice,
        updated_at: new Date().toISOString(),
      }
    );

    if (strategy === "fixed_tp" || strategy === "trailing_stop") {
      await callBybitConnector(env, userId, "set_bybit_tp_sl", {
        symbol,
        takeProfit: tpPrice.toFixed(2),
      });
    }

    await sendTelegramMessage(
      env,
      chat_id,
      `🤝 <b>[${symbol}]</b> Active position detected! Bot has taken over.\n` +
        `• Entry Price: <code>${entryPrice}</code>\n` +
        `• Strategy: <code>${strategy.toUpperCase()}</code>\n` +
        `• Take Profit set to: <code>${tpPrice.toFixed(2)}</code>`
    );
  } else {
    await sendTelegramMessage(
      env,
      chat_id,
      `ℹ️ No active position detected on exchange yet. Bot will keep checking.`
    );
  }
}

async function handleStatusCommand(env: Env, chat_id: string, userId: string, text: string) {
  const parts = text.split(" ").filter(Boolean);
  if (parts.length < 2) {
    await sendTelegramMessage(env, chat_id, "⚠️ Formatting error. Use: <code>/status &lt;symbol&gt;</code>");
    return;
  }

  const symbol = parts[1].toUpperCase();

  // Fetch state
  const stateRes = await supabaseFetch(
    env,
    `/rest/v1/trading_states?user_id=eq.${userId}&symbol=eq.${symbol}&select=state,bias_direction,position_taken_over`
  );
  const state = stateRes && stateRes.length > 0 ? stateRes[0] : { state: "IDLE", bias_direction: "NONE", position_taken_over: false };

  // Fetch position
  let positionText = "No active position detected on exchange.";
  try {
    const posRes = await callBybitConnector(env, userId, "get_bybit_positions", { symbol });
    const position = posRes.list && posRes.list.length > 0 ? posRes.list[0] : null;

    if (position && parseFloat(position.size) > 0) {
      positionText =
        `• Side: <b>${position.side}</b>\n` +
        `• Size: <code>${position.size}</code>\n` +
        `• Entry Price: <code>${position.entryPrice}</code>\n` +
        `• Mark Price: <code>${position.markPrice}</code>\n` +
        `• Unrealised PnL: <code>$${parseFloat(position.unrealisedPnl).toFixed(2)}</code>\n` +
        `• TP / SL: <code>${position.takeProfit || "None"}</code> / <code>${position.stopLoss || "None"}</code>`;
    }
  } catch (e: any) {
    positionText = `Error querying position: ${e.message}`;
  }

  const statusMsg =
    `📊 <b>Status for ${symbol}:</b>\n\n` +
    `<b>Bot State:</b>\n` +
    `• State Machine: <code>${state.state}</code>\n` +
    `• Current Bias: <b>${state.bias_direction}</b>\n` +
    `• Managing Position: <b>${state.position_taken_over ? "YES" : "NO"}</b>\n\n` +
    `<b>Exchange Position:</b>\n` +
    positionText;

  await sendTelegramMessage(env, chat_id, statusMsg);
}

async function handleExitCommand(env: Env, chat_id: string, userId: string, text: string) {
  const parts = text.split(" ").filter(Boolean);
  if (parts.length < 2) {
    await sendTelegramMessage(env, chat_id, "⚠️ Formatting error. Use: <code>/exit &lt;symbol&gt;</code>");
    return;
  }

  const symbol = parts[1].toUpperCase();

  try {
    const posRes = await callBybitConnector(env, userId, "get_bybit_positions", { symbol });
    const position = posRes.list && posRes.list.length > 0 ? posRes.list[0] : null;

    if (position && parseFloat(position.size) > 0) {
      const side = position.side;
      const closeSide = side === "Buy" ? "Sell" : "Buy";

      await sendTelegramMessage(env, chat_id, `🏁 Executing market exit for <b>${symbol}</b>...`);

      // Place market close order
      const orderRes = await callBybitConnector(env, userId, "place_bybit_order", {
        symbol,
        side: closeSide,
        orderType: "Market",
        qty: position.size,
        reduceOnly: true,
      });

      // Update state
      await supabasePatch(
        env,
        `/rest/v1/trading_states?user_id=eq.${userId}&symbol=eq.${symbol}`,
        {
          state: "IDLE",
          bias_direction: "NONE",
          position_taken_over: false,
          entry_price: null,
          updated_at: new Date().toISOString(),
        }
      );

      await sendTelegramMessage(
        env,
        chat_id,
        `✅ <b>Exit Successful!</b>\n` +
          `Closed ${position.size} ${symbol} ${side} position.\n` +
          `Order ID: <code>${orderRes.orderId}</code>.\n` +
          `State reset to IDLE.`
      );
    } else {
      await sendTelegramMessage(env, chat_id, `⚠️ No active position found on Bybit for <b>${symbol}</b>.`);
    }
  } catch (e: any) {
    await sendTelegramMessage(env, chat_id, `❌ Exit failed: ${e.message}`);
  }
}

// --- Stateful Trigger Process Webhook Transitions ---

async function processAlertTransition(
  env: Env,
  userId: string,
  symbol: string,
  timeframe: string,
  type: string,
  direction: string
) {
  // Get current state
  const stateRes = await supabaseFetch(
    env,
    `/rest/v1/trading_states?user_id=eq.${userId}&symbol=eq.${symbol}&select=state,bias_direction`
  );
  const currentState = stateRes && stateRes.length > 0 ? stateRes[0].state : "IDLE";
  const currentBias = stateRes && stateRes.length > 0 ? stateRes[0].bias_direction : "NONE";

  const settings = await supabaseFetch(
    env,
    `/rest/v1/telegram_settings?user_id=eq.${userId}&select=telegram_chat_id`
  );
  const chat_id = settings && settings.length > 0 ? settings[0].telegram_chat_id : null;

  const dir = direction.toUpperCase();

  // 1. BIAS Transition (15m/30m)
  if (type === "bias" && (timeframe === "30m" || timeframe === "15m")) {
    await supabaseWrite(
      env,
      "/rest/v1/trading_states",
      {
        user_id: userId,
        symbol,
        state: "BIAS_ESTABLISHED",
        bias_direction: dir,
        bias_timestamp: new Date().toISOString(),
        setup_timestamp: null,
        entry_timestamp: null,
        updated_at: new Date().toISOString(),
      },
      { Prefer: "resolution=merge-duplicates" }
    );

    if (chat_id) {
      await sendTelegramMessage(
        env,
        chat_id,
        `📈 <b>[${symbol}]</b> BIAS established as <b>${dir}</b> (timeframe: ${timeframe}). Waiting for SETUP.`
      );
    }
  }

  // 2. SETUP Transition (5m)
  else if (type === "setup" && timeframe === "5m") {
    if (currentState === "BIAS_ESTABLISHED" && currentBias === dir) {
      await supabasePatch(
        env,
        `/rest/v1/trading_states?user_id=eq.${userId}&symbol=eq.${symbol}`,
        {
          state: "SETUP_ESTABLISHED",
          setup_timestamp: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      );

      if (chat_id) {
        await sendTelegramMessage(
          env,
          chat_id,
          `🔍 <b>[${symbol}]</b> 5m SETUP confirmed for <b>${dir}</b>. Waiting for ENTRY.`
        );
      }
    }
  }

  // 3. ENTRY Transition (1m)
  else if (type === "entry" && timeframe === "1m") {
    if (currentState === "SETUP_ESTABLISHED" && currentBias === dir) {
      await supabasePatch(
        env,
        `/rest/v1/trading_states?user_id=eq.${userId}&symbol=eq.${symbol}`,
        {
          entry_timestamp: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      );

      if (chat_id) {
        await sendTelegramMessage(
          env,
          chat_id,
          `🚨 <b>[${symbol}]</b> 1m ENTRY SIGNAL TRIGGERED for <b>${dir}</b>!\nBot checking exchange for position...`
        );
      }

      // Check Bybit positions immediately
      try {
        const positionRes = await callBybitConnector(env, userId, "get_bybit_positions", { symbol });
        const position = positionRes.list && positionRes.list.length > 0 ? positionRes.list[0] : null;

        if (position && parseFloat(position.size) > 0) {
          const entryPrice = parseFloat(position.entryPrice);
          const side = position.side;

          const presets = await supabaseFetch(
            env,
            `/rest/v1/trading_presets?user_id=eq.${userId}&symbol=eq.${symbol}&select=tp_distance_pct,exit_strategy`
          );

          const tpPct = presets && presets.length > 0 ? parseFloat(presets[0].tp_distance_pct) : 1.0;
          const strategy = presets && presets.length > 0 ? presets[0].exit_strategy : "fixed_tp";

          let tpPrice = 0;
          if (side === "Buy") {
            tpPrice = entryPrice * (1 + tpPct / 100);
          } else {
            tpPrice = entryPrice * (1 - tpPct / 100);
          }

          // Update State to MANAGING
          await supabasePatch(
            env,
            `/rest/v1/trading_states?user_id=eq.${userId}&symbol=eq.${symbol}`,
            {
              state: "MANAGING_POSITION",
              position_taken_over: true,
              entry_price: entryPrice,
              updated_at: new Date().toISOString(),
            }
          );

          // Set TP on Exchange
          if (strategy === "fixed_tp" || strategy === "trailing_stop") {
            await callBybitConnector(env, userId, "set_bybit_tp_sl", {
              symbol,
              takeProfit: tpPrice.toFixed(2),
            });
          }

          if (chat_id) {
            await sendTelegramMessage(
              env,
              chat_id,
              `🤝 <b>[${symbol}]</b> Active position detected! Bot has taken over.\n` +
                `• Entry Price: <code>${entryPrice}</code>\n` +
                `• Strategy: <code>${strategy.toUpperCase()}</code>\n` +
                `• Take Profit set to: <code>${tpPrice.toFixed(2)}</code>`
            );
          }
        }
      } catch (e: any) {
        console.error("Failed to check position after entry", e);
      }
    }
  }

  // 4. EXIT Transition
  else if (type === "exit") {
    if (currentState === "MANAGING_POSITION") {
      try {
        const posRes = await callBybitConnector(env, userId, "get_bybit_positions", { symbol });
        const position = posRes.list && posRes.list.length > 0 ? posRes.list[0] : null;

        if (position && parseFloat(position.size) > 0) {
          const side = position.side;
          const closeSide = side === "Buy" ? "Sell" : "Buy";

          if (chat_id) {
            await sendTelegramMessage(env, chat_id, `🏁 Exit Alert received for <b>${symbol}</b>. Executing market exit...`);
          }

          // Place close order
          await callBybitConnector(env, userId, "place_bybit_order", {
            symbol,
            side: closeSide,
            orderType: "Market",
            qty: position.size,
            reduceOnly: true,
          });
        }

        // Reset state
        await supabasePatch(
          env,
          `/rest/v1/trading_states?user_id=eq.${userId}&symbol=eq.${symbol}`,
          {
            state: "IDLE",
            bias_direction: "NONE",
            position_taken_over: false,
            entry_price: null,
            updated_at: new Date().toISOString(),
          }
        );

        if (chat_id) {
          await sendTelegramMessage(env, chat_id, `✅ Position exited successfully. State reset to IDLE.`);
        }
      } catch (e: any) {
        console.error("Exit alert processing failed", e);
      }
    }
  }
}

// --- Helpers ---

async function sha256Hex(text: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function supabaseFetch(env: Env, endpoint: string): Promise<any> {
  const response = await fetch(`${env.SUPABASE_URL}${endpoint}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY || "",
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY || ""}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase query failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

async function supabaseWrite(env: Env, endpoint: string, body: any, extraHeaders: Record<string, string> = {}): Promise<any> {
  const response = await fetch(`${env.SUPABASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY || "",
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY || ""}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Supabase write failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function supabasePatch(env: Env, endpoint: string, body: any): Promise<any> {
  const response = await fetch(`${env.SUPABASE_URL}${endpoint}`, {
    method: "PATCH",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY || "",
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY || ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Supabase patch failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function sendTelegramMessage(env: Env, chat_id: string, text: string): Promise<any> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.log(`[Telegram Mock] Chat: ${chat_id}, Text: ${text}`);
    return { ok: true, result: { message_id: 1 } };
  }

  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id,
      text,
      parse_mode: "HTML",
    }),
  });

  return await response.json();
}

async function callBybitConnector(env: Env, userId: string, method: string, params: any): Promise<any> {
  let decryptedPayloadStr = "";

  if (env.ENVIRONMENT === "test" || !env.VAULT_ENCRYPTION_KEY) {
    decryptedPayloadStr = JSON.stringify({ bridgeUrl: "sandbox", apiKey: "sandbox", apiSecret: "sandbox" });
  } else {
    const vaultRes = await supabaseFetch(
      env,
      `/rest/v1/credential_vault?user_id=eq.${userId}&connector_id=eq.bybit&select=encrypted_payload`
    );

    if (!vaultRes || vaultRes.length === 0) {
      decryptedPayloadStr = JSON.stringify({ bridgeUrl: "sandbox", apiKey: "sandbox", apiSecret: "sandbox" });
    } else {
      decryptedPayloadStr = await decryptPayload(vaultRes[0].encrypted_payload, env.VAULT_ENCRYPTION_KEY);
    }
  }

  const base64VaultPayload = btoa(decryptedPayloadStr);

  const response = await env.BYBIT_CONNECTOR.fetch("http://bybit-connector/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-vault-payload": base64VaultPayload,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: method,
        arguments: params,
      },
      id: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`Bybit Connector HTTP error: ${response.status} ${response.statusText}`);
  }

  const json: any = await response.json();
  if (json.error) {
    throw new Error(`Bybit Connector error: [${json.error.code}] ${json.error.message}`);
  }

  return JSON.parse(json.result.content[0].text);
}

// AES-GCM Decryption
async function decryptPayload(encryptedPayload: string, secretKeyHex: string): Promise<string> {
  const [ivBase64, ciphertextBase64] = encryptedPayload.split(":");
  if (!ivBase64 || !ciphertextBase64) {
    throw new Error("Invalid encrypted payload format");
  }

  const iv = hexOrBase64ToUint8Array(ivBase64, "base64");
  const ciphertext = hexOrBase64ToUint8Array(ciphertextBase64, "base64");
  const keyBytes = hexOrBase64ToUint8Array(secretKeyHex, "hex");

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

function hexOrBase64ToUint8Array(str: string, encoding: "hex" | "base64"): Uint8Array {
  if (encoding === "hex") {
    const bytes = new Uint8Array(str.length / 2);
    for (let i = 0; i < str.length; i += 2) {
      bytes[i / 2] = parseInt(str.substring(i, i + 2), 16);
    }
    return bytes;
  } else {
    const binString = atob(str);
    const bytes = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) {
      bytes[i] = binString.charCodeAt(i);
    }
    return bytes;
  }
}
