import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "workers/gateway",
  "workers/connectors/mt5",
  "workers/connectors/bybit",
  "workers/connectors/tradingview",
  "workers/connectors/fred",
  "workers/connectors/ohlcv",
  "workers/telegram-bot",
  "workers/stripe-webhook"
]);
