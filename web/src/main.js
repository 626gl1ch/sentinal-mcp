import { createClient } from "@supabase/supabase-js";

// --- Configuration Setup (with dynamic local fallback) ---
const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || localStorage.getItem("BASTION_SUPABASE_URL") || "",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem("BASTION_SUPABASE_ANON_KEY") || "",
  gatewayUrl: import.meta.env.VITE_GATEWAY_URL || localStorage.getItem("BASTION_GATEWAY_URL") || "http://localhost:8787"
};

// Check if configuration is missing and render a setup bar if needed
let supabase = null;
if (config.supabaseUrl && config.supabaseAnonKey) {
  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
}

// --- DOM References ---
const authScreen = document.getElementById("auth-screen");
const dashboardLayout = document.getElementById("dashboard-layout");
const authForm = document.getElementById("auth-form");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const btnLogin = document.getElementById("btn-login");
const btnSignup = document.getElementById("btn-signup");
const authError = document.getElementById("auth-error");

const userDisplayEmail = document.getElementById("user-display-email");
const userDisplayTier = document.getElementById("user-display-tier");
const btnLogout = document.getElementById("btn-logout");

const navItems = document.querySelectorAll(".nav-item");
const tabPanels = document.querySelectorAll(".tab-panel");

// Stats DOM
const statActiveCredentials = document.getElementById("stat-active-credentials");
const statApiKeys = document.getElementById("stat-api-keys");
const statRateLimit = document.getElementById("stat-rate-limit");
const connectorsStatusTable = document.getElementById("connectors-status-table");
const recentLogsConsole = document.getElementById("recent-logs-console");

// Credentials Tab DOM
const vaultForm = document.getElementById("vault-form");
const vaultConnector = document.getElementById("vault-connector");
const vaultLabel = document.getElementById("vault-label");
const vaultSuccess = document.getElementById("vault-success");
const vaultErrorMsg = document.getElementById("vault-error");
const credentialsListContainer = document.getElementById("credentials-list-container");

const connectorFieldsMt5 = document.getElementById("connector-fields-mt5");
const mt5Url = document.getElementById("mt5-url");
const mt5Token = document.getElementById("mt5-token");

const connectorFieldsBybit = document.getElementById("connector-fields-bybit");
const bybitKey = document.getElementById("bybit-key");
const bybitSecret = document.getElementById("bybit-secret");
const bybitTestnet = document.getElementById("bybit-testnet");

// API Keys Tab DOM
const keyGenerationForm = document.getElementById("key-generation-form");
const keyLabel = document.getElementById("key-label");
const apiKeysTableBody = document.getElementById("api-keys-table-body");
const keyModal = document.getElementById("key-modal");
const newKeyDisplay = document.getElementById("new-key-display");
const btnCopyKey = document.getElementById("btn-copy-key");
const btnCloseModal = document.getElementById("btn-close-modal");

// Audit Log DOM
const auditLogsTableBody = document.getElementById("audit-logs-table-body");

// Trading Bot Tab DOM
const botPresetForm = document.getElementById("bot-preset-form");
const presetSymbol = document.getElementById("preset-symbol");
const presetTpPct = document.getElementById("preset-tp-pct");
const presetStrategy = document.getElementById("preset-strategy");
const presetTrailingContainer = document.getElementById("preset-trailing-container");
const presetTrailingPct = document.getElementById("preset-trailing-pct");
const presetSuccess = document.getElementById("preset-success");
const presetError = document.getElementById("preset-error");

const tgChatIdInput = document.getElementById("tg-chat-id-input");
const btnUnlinkTg = document.getElementById("btn-unlink-tg");
const tgStatusMessage = document.getElementById("tg-status-message");
const botStatesTableBody = document.getElementById("bot-states-table-body");

let currentUser = null;
let activeUserApiKey = "";

// --- Init & Settings Bar Injection ---
function init() {
  injectSettingsPanelIfNeeded();
  
  if (!supabase) {
    showSetupNotification();
    return;
  }

  // Setup auth state listener
  supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
      currentUser = session.user;
      showDashboard();
    } else {
      currentUser = null;
      activeUserApiKey = "";
      showAuth();
    }
  });

  setupEventListeners();
}

// Inject a configuration drawer if credentials are not configured yet
function injectSettingsPanelIfNeeded() {
  if (document.getElementById("bastion-settings-drawer")) return;

  const drawer = document.createElement("div");
  drawer.id = "bastion-settings-drawer";
  drawer.style.cssText = `
    position: fixed; bottom: 15px; right: 15px; z-index: 1000;
    padding: 15px; background: rgba(5, 7, 8, 0.95); border: 1px solid var(--border-color);
    border-radius: 6px; font-family: var(--font-mono); font-size: 11px; width: 280px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5); transition: transform 0.3s ease;
  `;

  const isConfigured = config.supabaseUrl && config.supabaseAnonKey;

  drawer.innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:10px; cursor:pointer;" id="settings-title">
      <span style="font-weight:bold; color:var(--accent-amber)">⚙ CONFIGURATION BINDING</span>
      <span>${isConfigured ? "[COLLAPSE]" : "[OPEN]"}</span>
    </div>
    <div id="settings-body" class="${isConfigured ? "hidden" : ""}">
      <div style="margin-bottom:8px;">
        <label style="display:block; color:var(--text-muted); margin-bottom:3px;">SUPABASE URL</label>
        <input type="text" id="cfg-sb-url" style="width:100%; background:#111; border:1px solid #333; color:#fff; padding:4px;" value="${config.supabaseUrl}">
      </div>
      <div style="margin-bottom:8px;">
        <label style="display:block; color:var(--text-muted); margin-bottom:3px;">SUPABASE ANON KEY</label>
        <input type="password" id="cfg-sb-key" style="width:100%; background:#111; border:1px solid #333; color:#fff; padding:4px;" value="${config.supabaseAnonKey}">
      </div>
      <div style="margin-bottom:10px;">
        <label style="display:block; color:var(--text-muted); margin-bottom:3px;">GATEWAY WORKER URL</label>
        <input type="text" id="cfg-gt-url" style="width:100%; background:#111; border:1px solid #333; color:#fff; padding:4px;" value="${config.gatewayUrl}">
      </div>
      <button id="cfg-save" style="background:var(--accent-green); color:#000; border:none; padding:5px 10px; width:100%; cursor:pointer; font-weight:bold;">SAVE SETTINGS</button>
    </div>
  `;

  document.body.appendChild(drawer);

  const title = document.getElementById("settings-title");
  const body = document.getElementById("settings-body");
  title.addEventListener("click", () => {
    body.classList.toggle("hidden");
    title.querySelector("span:last-child").textContent = body.classList.contains("hidden") ? "[OPEN]" : "[COLLAPSE]";
  });

  document.getElementById("cfg-save").addEventListener("click", () => {
    const url = document.getElementById("cfg-sb-url").value.trim();
    const key = document.getElementById("cfg-sb-key").value.trim();
    const gt = document.getElementById("cfg-gt-url").value.trim();
    
    if (url) localStorage.setItem("BASTION_SUPABASE_URL", url);
    if (key) localStorage.setItem("BASTION_SUPABASE_ANON_KEY", key);
    if (gt) localStorage.setItem("BASTION_GATEWAY_URL", gt);

    window.location.reload();
  });
}

function showSetupNotification() {
  authScreen.classList.remove("hidden");
  authError.classList.remove("hidden");
  authError.textContent = "Please configure your Supabase URL & Anon Key in the CONFIGURATION BINDING panel below to start.";
}

// --- Event Handlers & Core Logic ---
function setupEventListeners() {
  // Auth Form Handlers
  btnLogin.addEventListener("click", handleLogin);
  btnSignup.addEventListener("click", handleSignup);
  btnLogout.addEventListener("click", handleLogout);

  // Tab switching
  navItems.forEach(item => {
    item.addEventListener("click", () => {
      navItems.forEach(nav => nav.classList.remove("active"));
      tabPanels.forEach(panel => panel.classList.add("hidden"));

      item.classList.add("active");
      const tabId = item.getAttribute("data-tab");
      document.getElementById(tabId).classList.remove("hidden");
    });
  });

  // Vault Form Connector toggle
  vaultConnector.addEventListener("change", (e) => {
    if (e.target.value === "mt5") {
      connectorFieldsMt5.classList.remove("hidden");
      connectorFieldsBybit.classList.add("hidden");
    } else {
      connectorFieldsMt5.classList.add("hidden");
      connectorFieldsBybit.classList.remove("hidden");
    }
  });

  // Vault credentials submission
  vaultForm.addEventListener("submit", handleVaultSubmission);

  // API Key generation
  keyGenerationForm.addEventListener("submit", handleApiKeyGeneration);

  // Trading Bot Strategy toggle
  presetStrategy.addEventListener("change", (e) => {
    if (e.target.value === "trailing_stop") {
      presetTrailingContainer.classList.remove("hidden");
    } else {
      presetTrailingContainer.classList.add("hidden");
    }
  });

  // Trading Bot Preset submission
  botPresetForm.addEventListener("submit", handlePresetSubmission);

  // Telegram Unlinking
  btnUnlinkTg.addEventListener("click", handleUnlinkTelegram);

  // Close modals
  btnCloseModal.addEventListener("click", () => keyModal.classList.add("hidden"));
  btnCopyKey.addEventListener("click", copyKeyToClipboard);
}

// --- Auth Actions ---
async function handleLogin(e) {
  e.preventDefault();
  authError.classList.add("hidden");
  const email = authEmail.value.trim();
  const password = authPassword.value;

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  } catch (err) {
    authError.classList.remove("hidden");
    authError.textContent = `Login Error: ${err.message}`;
  }
}

async function handleSignup(e) {
  e.preventDefault();
  authError.classList.add("hidden");
  const email = authEmail.value.trim();
  const password = authPassword.value;

  try {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: email.split("@")[0] }
      }
    });
    if (error) throw error;
    authError.classList.remove("hidden");
    authError.className = "success-msg";
    authError.textContent = "Registration successful! Please check your email for confirmation, or log in if auto-confirmed.";
  } catch (err) {
    authError.classList.remove("hidden");
    authError.className = "error-msg";
    authError.textContent = `Registration Error: ${err.message}`;
  }
}

async function handleLogout() {
  await supabase.auth.signOut();
}

// --- UI Navigation Toggles ---
function showAuth() {
  authScreen.classList.remove("hidden");
  dashboardLayout.classList.add("hidden");
}

async function showDashboard() {
  authScreen.classList.add("hidden");
  dashboardLayout.classList.remove("hidden");
  userDisplayEmail.textContent = currentUser.email;

  // Load User Data
  await loadSubscriptionInfo();
  await loadApiKeys(); // Load API Keys first so we can authenticate Gateway uploads
  await loadVaultCredentials();
  await loadAuditAndUsageLogs();
  loadConnectorStatuses();
  await loadBotSettingsAndStates();
}

// --- Data Loading Operations ---

async function loadSubscriptionInfo() {
  try {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("tier, status")
      .eq("user_id", currentUser.id);

    if (error) throw error;
    if (data && data.length > 0) {
      userDisplayTier.textContent = `Tier: ${data[0].tier.toUpperCase()} (${data[0].status})`;
    } else {
      userDisplayTier.textContent = "Tier: FREE (No Subscription)";
    }
  } catch (err) {
    console.error("Failed to load subscription info", err);
  }
}

async function loadApiKeys() {
  try {
    const { data: keys, error } = await supabase
      .from("api_keys")
      .select("id, key_prefix, label, created_at, last_used_at, revoked")
      .eq("user_id", currentUser.id)
      .eq("revoked", false)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Save the first active API key for our Gateway upload requests
    if (keys && keys.length > 0) {
      // In a real environment, we would prompt the user to input their API key,
      // but for dashboard comfort, we can use their Supabase session token or
      // look for a saved session API key in local storage. To bypass, we can
      // fetch using the Supabase client directly, but vault encryption happens
      // on the Gateway. So we need the actual raw API Key to hit `/credentials`.
      // We store keys in localStorage when they are created, so we can fetch it if saved!
      const savedKey = localStorage.getItem(`bastion_raw_key_${keys[0].key_prefix}`);
      if (savedKey) {
        activeUserApiKey = savedKey;
      }
    }

    statApiKeys.textContent = keys ? keys.length.toString() : "0";

    // Populate API keys table
    apiKeysTableBody.innerHTML = "";
    if (!keys || keys.length === 0) {
      apiKeysTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted)">No active API keys found. Generate one to connect clients.</td></tr>`;
      return;
    }

    keys.forEach(key => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td><code>${key.key_prefix}...</code></td>
        <td>${escapeHtml(key.label)}</td>
        <td>${new Date(key.created_at).toLocaleString()}</td>
        <td>${key.last_used_at ? new Date(key.last_used_at).toLocaleString() : "Never"}</td>
        <td><button class="btn secondary small btn-revoke-key" data-id="${key.id}">Revoke</button></td>
      `;
      apiKeysTableBody.appendChild(row);
    });

    // Revoke key handlers
    document.querySelectorAll(".btn-revoke-key").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const keyId = e.target.getAttribute("data-id");
        if (confirm("Are you sure you want to revoke this API key? This action is irreversible.")) {
          await revokeApiKey(keyId);
        }
      });
    });
  } catch (err) {
    console.error("Failed to load API keys", err);
  }
}

async function loadVaultCredentials() {
  try {
    const { data: creds, error } = await supabase
      .from("credential_vault")
      .select("id, connector_id, label, created_at")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    statActiveCredentials.textContent = creds ? creds.length.toString() : "0";

    credentialsListContainer.innerHTML = "";
    if (!creds || creds.length === 0) {
      credentialsListContainer.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:20px;">No credentials saved in vault.</div>`;
      return;
    }

    creds.forEach(cred => {
      const card = document.createElement("div");
      card.className = "credential-item";
      card.innerHTML = `
        <div class="credential-info">
          <span class="cred-label">${escapeHtml(cred.label)}</span>
          <span class="cred-meta">${cred.connector_id.toUpperCase()} • Configured ${new Date(cred.created_at).toLocaleDateString()}</span>
        </div>
        <button class="btn secondary small btn-delete-cred" data-id="${cred.id}">Delete</button>
      `;
      credentialsListContainer.appendChild(card);
    });

    document.querySelectorAll(".btn-delete-cred").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const id = e.target.getAttribute("data-id");
        if (confirm("Delete these credentials from the vault? Connectors using this account will stop working.")) {
          await deleteCredentials(id);
        }
      });
    });
  } catch (err) {
    console.error("Failed to load credentials vault", err);
  }
}

async function loadAuditAndUsageLogs() {
  try {
    // 1. Fetch Audit Logs
    const { data: audits, error: auditErr } = await supabase
      .from("audit_log")
      .select("created_at, action, metadata")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false })
      .limit(30);

    if (auditErr) throw auditErr;

    // Populate console logger
    recentLogsConsole.innerHTML = "";
    if (!audits || audits.length === 0) {
      recentLogsConsole.innerHTML = `<div class="log-line"><span style="color:var(--text-muted)">No recent system events.</span></div>`;
    } else {
      audits.slice(0, 5).forEach(log => {
        const line = document.createElement("div");
        line.className = "log-line";
        line.innerHTML = `
          <span class="log-time">[${new Date(log.created_at).toLocaleTimeString()}]</span>
          <span class="log-action">${log.action.toUpperCase()}</span>
          <span class="log-msg">${escapeHtml(JSON.stringify(log.metadata))}</span>
        `;
        recentLogsConsole.appendChild(line);
      });
    }

    // Populate complete Audit Logs table
    auditLogsTableBody.innerHTML = "";
    if (!audits || audits.length === 0) {
      auditLogsTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted)">No audit trail recorded yet.</td></tr>`;
    } else {
      audits.forEach(log => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${new Date(log.created_at).toLocaleString()}</td>
          <td><code>${log.action}</code></td>
          <td><code>${escapeHtml(JSON.stringify(log.metadata))}</code></td>
        `;
        auditLogsTableBody.appendChild(row);
      });
    }

    // 2. Fetch Usage Logs (to compute rate limit usage)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const { count, error: usageErr } = await supabase
      .from("usage_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", currentUser.id)
      .gte("created_at", today.toISOString());

    if (usageErr) throw usageErr;
    
    statRateLimit.textContent = `${count || 0} / 10000`; // Dynamic limits depending on tier
  } catch (err) {
    console.error("Failed to load system logs", err);
  }
}

function loadConnectorStatuses() {
  connectorsStatusTable.innerHTML = `
    <tr>
      <td><code>mt5</code></td>
      <td>MetaTrader 5</td>
      <td>Read-Only</td>
      <td><span class="badge active">ACTIVE</span></td>
    </tr>
    <tr>
      <td><code>bybit</code></td>
      <td>Bybit Perpetual</td>
      <td>Read-Only</td>
      <td><span class="badge active">ACTIVE</span></td>
    </tr>
  `;
}

// --- Credentials Actions ---

async function handleVaultSubmission(e) {
  e.preventDefault();
  vaultSuccess.classList.add("hidden");
  vaultErrorMsg.classList.add("hidden");

  // Determine active API Key for Gateway Authentication
  if (!activeUserApiKey) {
    // If no raw key is saved, try to use a sandbox fallback key or generate one
    const { data: keys } = await supabase.from("api_keys").select("key_prefix").eq("user_id", currentUser.id).eq("revoked", false);
    if (!keys || keys.length === 0) {
      vaultErrorMsg.classList.remove("hidden");
      vaultErrorMsg.textContent = "Please generate an API Key first on the API Keys tab. An API key is required to authorize vault encryption uploads to the Gateway.";
      return;
    }
    
    // Prompt the user to supply their key
    const inputKey = prompt("Please enter one of your active API keys to authorize this credential vault upload to the Gateway:");
    if (!inputKey) return;
    activeUserApiKey = inputKey;
  }

  const connectorId = vaultConnector.value;
  const label = vaultLabel.value.trim();
  let credentialsObj = {};

  if (connectorId === "mt5") {
    credentialsObj = {
      bridgeUrl: mt5Url.value.trim(),
      bridgeToken: mt5Token.value.trim() || undefined
    };
    if (!credentialsObj.bridgeUrl) {
      showVaultError("Bridge URL is required for MT5 connector.");
      return;
    }
  } else {
    credentialsObj = {
      apiKey: bybitKey.value.trim(),
      apiSecret: bybitSecret.value.trim(),
      useTestnet: bybitTestnet.checked
    };
    if (!credentialsObj.apiKey || !credentialsObj.apiSecret) {
      showVaultError("API Key and Secret are required for Bybit connector.");
      return;
    }
  }

  try {
    const res = await fetch(`${config.gatewayUrl}/connectors/${connectorId}/credentials`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${activeUserApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        label,
        credentials: credentialsObj
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gateway upload error [${res.status}]: ${errText}`);
    }

    const data = await res.json();
    if (data.success) {
      vaultSuccess.classList.remove("hidden");
      vaultForm.reset();
      await loadVaultCredentials();
      await loadAuditAndUsageLogs();
    } else {
      throw new Error(data.error || "Gateway rejected credentials upload");
    }
  } catch (err) {
    showVaultError(err.message);
  }
}

function showVaultError(msg) {
  vaultErrorMsg.classList.remove("hidden");
  vaultErrorMsg.textContent = `Upload failed: ${msg}`;
}

async function deleteCredentials(id) {
  try {
    const { error } = await supabase
      .from("credential_vault")
      .delete()
      .eq("id", id);
    if (error) throw error;
    
    // Log deletion to audit log
    await supabase.from("audit_log").insert({
      user_id: currentUser.id,
      action: "credential_deleted",
      metadata: { credential_id: id }
    });

    await loadVaultCredentials();
    await loadAuditAndUsageLogs();
  } catch (err) {
    alert(`Failed to delete credentials: ${err.message}`);
  }
}

// --- API Key Actions ---

async function handleApiKeyGeneration(e) {
  e.preventDefault();
  const label = keyLabel.value.trim();

  // 1. Generate local cryptographically secure random key
  const prefix = "bm_"; // BastionMCP prefix
  const randBytes = crypto.getRandomValues(new Uint8Array(20));
  const hexKey = Array.from(randBytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  const rawKey = prefix + hexKey;

  // 2. Hash key with SHA-256
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  const keyPrefix = rawKey.substring(0, 8);

  try {
    // 3. Write hash and metadata to Supabase api_keys table
    const { error } = await supabase
      .from("api_keys")
      .insert({
        user_id: currentUser.id,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        label: label
      });

    if (error) throw error;

    // Log action to audit log
    await supabase.from("audit_log").insert({
      user_id: currentUser.id,
      action: "api_key_generated",
      metadata: { label, prefix: keyPrefix }
    });

    // Save key in localStorage so the user can easily manage credentials from their own dashboard
    localStorage.setItem(`bastion_raw_key_${keyPrefix}`, rawKey);
    activeUserApiKey = rawKey;

    // 4. Show modal with rawKey
    newKeyDisplay.textContent = rawKey;
    keyModal.classList.remove("hidden");
    keyGenerationForm.reset();

    await loadApiKeys();
    await loadAuditAndUsageLogs();
  } catch (err) {
    alert(`Key generation failed: ${err.message}`);
  }
}

async function revokeApiKey(id) {
  try {
    const { error } = await supabase
      .from("api_keys")
      .update({ revoked: true })
      .eq("id", id);
    
    if (error) throw error;

    // Log action to audit log
    await supabase.from("audit_log").insert({
      user_id: currentUser.id,
      action: "api_key_revoked",
      metadata: { key_id: id }
    });

    await loadApiKeys();
    await loadAuditAndUsageLogs();
  } catch (err) {
    alert(`Failed to revoke key: ${err.message}`);
  }
}

function copyKeyToClipboard() {
  navigator.clipboard.writeText(newKeyDisplay.textContent);
  btnCopyKey.textContent = "Copied!";
  setTimeout(() => btnCopyKey.textContent = "Copy", 1500);
}

// --- Trading Bot Operations ---

async function loadBotSettingsAndStates() {
  try {
    // 1. Fetch Telegram chat status
    const { data: tgSettings, error: tgErr } = await supabase
      .from("telegram_settings")
      .select("telegram_chat_id")
      .eq("user_id", currentUser.id);

    if (tgErr) throw tgErr;

    if (tgSettings && tgSettings.length > 0) {
      tgChatIdInput.value = tgSettings[0].telegram_chat_id;
      btnUnlinkTg.classList.remove("hidden");
      tgStatusMessage.innerHTML = `<span style="color:var(--accent-green); font-weight:bold;">● LINKED</span> to Telegram chat ID: <code>${tgSettings[0].telegram_chat_id}</code>`;
    } else {
      tgChatIdInput.value = "";
      btnUnlinkTg.classList.add("hidden");
      tgStatusMessage.innerHTML = `No Telegram chat linked. Start the bot on Telegram and register with your API Key to link.`;
    }

    // 2. Fetch Presets and States
    const { data: presets, error: presetErr } = await supabase
      .from("trading_presets")
      .select("symbol, tp_distance_pct, exit_strategy, trailing_stop_pct")
      .eq("user_id", currentUser.id);

    if (presetErr) throw presetErr;

    const { data: states, error: stateErr } = await supabase
      .from("trading_states")
      .select("symbol, state, bias_direction, position_taken_over")
      .eq("user_id", currentUser.id);

    if (stateErr) throw stateErr;

    // Combine them by symbol
    const symbolMap = new Map();
    if (presets) {
      presets.forEach(p => {
        symbolMap.set(p.symbol.toUpperCase(), { preset: p, state: null });
      });
    }
    if (states) {
      states.forEach(s => {
        const sym = s.symbol.toUpperCase();
        if (symbolMap.has(sym)) {
          symbolMap.get(sym).state = s;
        } else {
          symbolMap.set(sym, { preset: null, state: s });
        }
      });
    }

    botStatesTableBody.innerHTML = "";
    if (symbolMap.size === 0) {
      botStatesTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:12px;">No active presets or state machine symbols.</td></tr>`;
      return;
    }

    symbolMap.forEach((val, sym) => {
      const row = document.createElement("tr");

      const presetText = val.preset
        ? `<code>${val.preset.tp_distance_pct}%</code> / <code>${val.preset.exit_strategy.toUpperCase()}</code>`
        : `<span style="color:var(--text-muted);">None</span>`;

      const stateText = val.state
        ? `<code>${val.state.state}</code>`
        : `<code>IDLE</code>`;

      const dirText = val.state
        ? `<span style="font-weight:bold; color:${val.state.bias_direction === "LONG" ? "var(--accent-green)" : val.state.bias_direction === "SHORT" ? "var(--text-error)" : "var(--text-muted)"}">${val.state.bias_direction}</span>`
        : `<span>NONE</span>`;

      row.innerHTML = `
        <td><b>${sym}</b></td>
        <td>${presetText}</td>
        <td>${stateText}</td>
        <td>${dirText}</td>
        <td>
          <div style="display:flex; gap:5px;">
            ${val.state && val.state.state !== "IDLE" ? `<button class="btn secondary small btn-reset-bot" data-symbol="${sym}">Reset State</button>` : ""}
            ${val.preset ? `<button class="btn secondary small btn-delete-preset" data-symbol="${sym}" style="color:var(--text-error); border-color:rgba(248,81,73,0.15)">Delete Preset</button>` : ""}
          </div>
        </td>
      `;
      botStatesTableBody.appendChild(row);
    });

    // Add button event listeners
    document.querySelectorAll(".btn-reset-bot").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const sym = e.currentTarget.getAttribute("data-symbol");
        if (confirm(`Reset state machine for ${sym} to IDLE?`)) {
          await resetBotState(sym);
        }
      });
    });

    document.querySelectorAll(".btn-delete-preset").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const sym = e.currentTarget.getAttribute("data-symbol");
        if (confirm(`Delete preset for ${sym}?`)) {
          await deletePreset(sym);
        }
      });
    });

  } catch (err) {
    console.error("Failed to load trading bot settings/states", err);
  }
}

async function resetBotState(symbol) {
  try {
    const { error } = await supabase
      .from("trading_states")
      .update({
        state: "IDLE",
        bias_direction: "NONE",
        position_taken_over: false,
        entry_price: null,
        updated_at: new Date().toISOString()
      })
      .eq("user_id", currentUser.id)
      .eq("symbol", symbol.toUpperCase());

    if (error) throw error;
    await loadBotSettingsAndStates();
  } catch (err) {
    alert(`Failed to reset bot state: ${err.message}`);
  }
}

async function deletePreset(symbol) {
  try {
    const { error } = await supabase
      .from("trading_presets")
      .delete()
      .eq("user_id", currentUser.id)
      .eq("symbol", symbol.toUpperCase());

    if (error) throw error;
    await loadBotSettingsAndStates();
  } catch (err) {
    alert(`Failed to delete preset: ${err.message}`);
  }
}

async function handleUnlinkTelegram() {
  if (confirm("Are you sure you want to unlink your Telegram account? You will stop receiving notifications and commands.")) {
    try {
      const { error } = await supabase
        .from("telegram_settings")
        .delete()
        .eq("user_id", currentUser.id);

      if (error) throw error;
      await loadBotSettingsAndStates();
    } catch (err) {
      alert(`Failed to unlink Telegram: ${err.message}`);
    }
  }
}

async function handlePresetSubmission(e) {
  e.preventDefault();
  presetSuccess.classList.add("hidden");
  presetError.classList.add("hidden");

  const symbol = presetSymbol.value.trim().toUpperCase();
  const tpPct = parseFloat(presetTpPct.value);
  const strategy = presetStrategy.value;
  const trailingStopPct = strategy === "trailing_stop" ? parseFloat(presetTrailingPct.value) : null;

  if (strategy === "trailing_stop" && (!trailingStopPct || isNaN(trailingStopPct) || trailingStopPct <= 0)) {
    presetError.classList.remove("hidden");
    presetError.textContent = "Please enter a valid positive trailing stop percentage.";
    return;
  }

  try {
    const { error } = await supabase
      .from("trading_presets")
      .upsert({
        user_id: currentUser.id,
        symbol,
        tp_distance_pct: tpPct,
        exit_strategy: strategy,
        trailing_stop_pct: trailingStopPct,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id,symbol" });

    if (error) throw error;

    presetSuccess.classList.remove("hidden");
    botPresetForm.reset();
    presetTrailingContainer.classList.add("hidden");
    await loadBotSettingsAndStates();
  } catch (err) {
    presetError.classList.remove("hidden");
    presetError.textContent = `Save failed: ${err.message}`;
  }
}

// --- Utils ---
function escapeHtml(text) {
  if (typeof text !== "string") return JSON.stringify(text);
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Initialize on DOM load
document.addEventListener("DOMContentLoaded", init);
