import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "workers/gateway",
  "workers/connectors/mt5",
  "workers/connectors/bybit",
  "workers/telegram-bot"
]);
