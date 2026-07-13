import { createClient } from "@supabase/supabase-js";

// --- Configuration Setup (with Sentinel-MCP namespace & legacy fallback) ---
const config = {
  supabaseUrl:
    import.meta.env.VITE_SUPABASE_URL ||
    localStorage.getItem("SENTINEL_SUPABASE_URL") ||
    localStorage.getItem("BASTION_SUPABASE_URL") ||
    "",
  supabaseAnonKey:
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    localStorage.getItem("SENTINEL_SUPABASE_ANON_KEY") ||
    localStorage.getItem("BASTION_SUPABASE_ANON_KEY") ||
    "",
  gatewayUrl:
    import.meta.env.VITE_GATEWAY_URL ||
    localStorage.getItem("SENTINEL_GATEWAY_URL") ||
    localStorage.getItem("BASTION_GATEWAY_URL") ||
    "http://localhost:8787"
};

// Initialize Supabase Client
let supabase = null;
if (config.supabaseUrl && config.supabaseAnonKey) {
  try {
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  } catch (e) {
    console.error("Failed to initialize Supabase client", e);
  }
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
const userAvatarInitial = document.getElementById("user-avatar-initial");
const settingsDisplayEmail = document.getElementById("settings-display-email");
const btnLogout = document.getElementById("btn-logout");
const btnLogoutSettings = document.getElementById("btn-logout-settings");

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

// Settings Tab DOM
const cfgSbUrl = document.getElementById("cfg-sb-url");
const cfgSbKey = document.getElementById("cfg-sb-key");
const cfgGtUrl = document.getElementById("cfg-gt-url");
const cfgSaveBtn = document.getElementById("cfg-save-btn");
const cfgSaveMsg = document.getElementById("cfg-save-msg");

// Modal DOM Helpers
const confirmModal = document.getElementById("confirm-modal");
const confirmModalTitle = document.getElementById("confirm-modal-title");
const confirmModalBody = document.getElementById("confirm-modal-body");
const confirmModalCancel = document.getElementById("confirm-modal-cancel");
const confirmModalOk = document.getElementById("confirm-modal-ok");

const apiKeyInputModal = document.getElementById("api-key-input-modal");
const apiKeyPromptInput = document.getElementById("api-key-prompt-input");
const apiKeyPromptCancel = document.getElementById("api-key-prompt-cancel");
const apiKeyPromptOk = document.getElementById("api-key-prompt-ok");

const toastContainer = document.getElementById("toast-container");

let currentUser = null;
let activeUserApiKey = "";

// --- Toast System ---
function showToast(title, message, type = "info", duration = 4000) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const iconMap = {
    success: "✓",
    error: "✕",
    info: "ℹ",
    warning: "⚠️"
  };

  toast.innerHTML = `
    <div class="toast-icon">${iconMap[type] || "ℹ"}</div>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${message ? `<div class="toast-message">${escapeHtml(message)}</div>` : ""}
    </div>
  `;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-out");
    toast.addEventListener("animationend", () => toast.remove());
  }, duration);
}

// --- Custom Confirm Modal Helper ---
function customConfirm(title, message, actionText = "Confirm") {
  return new Promise((resolve) => {
    confirmModalTitle.textContent = title;
    confirmModalBody.textContent = message;
    confirmModalOk.textContent = actionText;
    confirmModal.classList.remove("hidden");

    const cleanup = () => {
      confirmModal.classList.add("hidden");
      confirmModalOk.removeEventListener("click", onOk);
      confirmModalCancel.removeEventListener("click", onCancel);
    };

    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };

    confirmModalOk.addEventListener("click", onOk);
    confirmModalCancel.addEventListener("click", onCancel);
  });
}

// --- Custom Prompt API Key Modal Helper ---
function customPromptApiKey() {
  return new Promise((resolve) => {
    apiKeyPromptInput.value = "";
    apiKeyInputModal.classList.remove("hidden");
    apiKeyPromptInput.focus();

    const cleanup = () => {
      apiKeyInputModal.classList.add("hidden");
      apiKeyPromptOk.removeEventListener("click", onOk);
      apiKeyPromptCancel.removeEventListener("click", onCancel);
    };

    const onOk = () => {
      const val = apiKeyPromptInput.value.trim();
      cleanup();
      resolve(val || null);
    };
    const onCancel = () => { cleanup(); resolve(null); };

    apiKeyPromptOk.addEventListener("click", onOk);
    apiKeyPromptCancel.addEventListener("click", onCancel);
  });
}

// --- Application Init ---
function init() {
  // Populate Settings inputs with current values
  if (cfgSbUrl) cfgSbUrl.value = config.supabaseUrl;
  if (cfgSbKey) cfgSbKey.value = config.supabaseAnonKey;
  if (cfgGtUrl) cfgGtUrl.value = config.gatewayUrl;

  if (!supabase) {
    showSetupNotification();
    setupSettingsListenerOnly();
    return;
  }

  // Auth State Listener
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

function setupSettingsListenerOnly() {
  if (cfgSaveBtn) {
    cfgSaveBtn.addEventListener("click", handleSaveSettings);
  }
}

function showSetupNotification() {
  authScreen.classList.remove("hidden");
  dashboardLayout.classList.add("hidden");
  authError.classList.remove("hidden");
  authError.innerHTML = "<strong>Setup Required:</strong> Please configure your Supabase URL & Anon Key in the Settings tab or localStorage.";
}

// --- Event Listeners ---
function setupEventListeners() {
  // Auth
  authForm.addEventListener("submit", handleLogin);
  btnSignup.addEventListener("click", handleSignup);
  btnLogout.addEventListener("click", handleLogout);
  if (btnLogoutSettings) btnLogoutSettings.addEventListener("click", handleLogout);

  // Navigation Tab Switching
  navItems.forEach(item => {
    item.addEventListener("click", () => {
      navItems.forEach(nav => nav.classList.remove("active"));
      tabPanels.forEach(panel => panel.classList.add("hidden"));

      item.classList.add("active");
      const tabId = item.getAttribute("data-tab");
      const targetPanel = document.getElementById(tabId);
      if (targetPanel) {
        targetPanel.classList.remove("hidden");
        targetPanel.classList.add("entering");
        setTimeout(() => targetPanel.classList.remove("entering"), 200);
      }
    });
  });

  // Vault form fields toggle
  vaultConnector.addEventListener("change", (e) => {
    if (e.target.value === "mt5") {
      connectorFieldsMt5.classList.remove("hidden");
      connectorFieldsBybit.classList.add("hidden");
    } else {
      connectorFieldsMt5.classList.add("hidden");
      connectorFieldsBybit.classList.remove("hidden");
    }
  });

  // Forms
  vaultForm.addEventListener("submit", handleVaultSubmission);
  keyGenerationForm.addEventListener("submit", handleApiKeyGeneration);

  // Trading bot strategy toggle
  presetStrategy.addEventListener("change", (e) => {
    if (e.target.value === "trailing_stop") {
      presetTrailingContainer.classList.remove("hidden");
    } else {
      presetTrailingContainer.classList.add("hidden");
    }
  });

  botPresetForm.addEventListener("submit", handlePresetSubmission);
  if (btnUnlinkTg) btnUnlinkTg.addEventListener("click", handleUnlinkTelegram);

  // Settings save
  if (cfgSaveBtn) cfgSaveBtn.addEventListener("click", handleSaveSettings);

  // Key Modal Close & Copy
  btnCloseModal.addEventListener("click", () => keyModal.classList.add("hidden"));
  btnCopyKey.addEventListener("click", copyKeyToClipboard);
}

// --- Auth Operations ---
async function handleLogin(e) {
  e.preventDefault();
  authError.classList.add("hidden");
  btnLogin.disabled = true;
  btnLogin.textContent = "Authenticating…";

  const email = authEmail.value.trim();
  const password = authPassword.value;

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    showToast("Signed In", `Welcome back, ${email}`, "success");
  } catch (err) {
    authError.classList.remove("hidden");
    authError.textContent = `Authentication failed: ${err.message}`;
    showToast("Auth Error", err.message, "error");
  } finally {
    btnLogin.disabled = false;
    btnLogin.textContent = "Sign In";
  }
}

async function handleSignup(e) {
  e.preventDefault();
  authError.classList.add("hidden");
  const email = authEmail.value.trim();
  const password = authPassword.value;

  if (!email || !password) {
    authError.classList.remove("hidden");
    authError.textContent = "Please provide both email and password.";
    return;
  }

  try {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: email.split("@")[0] } }
    });
    if (error) throw error;
    authError.classList.remove("hidden");
    authError.className = "success-msg";
    authError.textContent = "Registration successful! Please check your email for confirmation, or log in.";
    showToast("Registration Complete", "Please check your inbox to confirm.", "info");
  } catch (err) {
    authError.classList.remove("hidden");
    authError.className = "error-msg";
    authError.textContent = `Registration Error: ${err.message}`;
    showToast("Registration Failed", err.message, "error");
  }
}

async function handleLogout() {
  const confirmed = await customConfirm("Sign Out", "Are you sure you want to sign out of Sentinal-MCP?", "Sign Out");
  if (confirmed) {
    await supabase.auth.signOut();
    showToast("Signed Out", "You have been logged out safely.", "info");
  }
}

// --- UI Navigation Operations ---
function showAuth() {
  authScreen.classList.remove("hidden");
  dashboardLayout.classList.add("hidden");
}

async function showDashboard() {
  authScreen.classList.add("hidden");
  dashboardLayout.classList.remove("hidden");

  // Set user display details
  userDisplayEmail.textContent = currentUser.email;
  if (settingsDisplayEmail) settingsDisplayEmail.textContent = currentUser.email;
  if (userAvatarInitial) userAvatarInitial.textContent = currentUser.email.charAt(0).toUpperCase();

  // Load active connector indicators immediately
  loadConnectorStatuses();

  // Load all dashboard components IN PARALLEL via Promise.all for zero-lag response
  try {
    await Promise.all([
      loadSubscriptionInfo(),
      loadApiKeys(),
      loadVaultCredentials(),
      loadAuditAndUsageLogs(),
      loadBotSettingsAndStates()
    ]);
  } catch (err) {
    console.error("Dashboard parallel load partial error:", err);
  }
}

// --- Parallel Data Loading Operations ---

async function loadSubscriptionInfo() {
  try {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("tier, status")
      .eq("user_id", currentUser.id);

    if (error) throw error;
    if (data && data.length > 0) {
      userDisplayTier.textContent = `${data[0].tier.toUpperCase()} (${data[0].status.toUpperCase()})`;
    } else {
      userDisplayTier.textContent = "FREE PLAN";
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

    if (keys && keys.length > 0) {
      // Check for locally cached raw key (checking both sentinel and legacy bastion namespaces)
      const prefix = keys[0].key_prefix;
      const savedKey =
        localStorage.getItem(`sentinel_raw_key_${prefix}`) ||
        localStorage.getItem(`bastion_raw_key_${prefix}`);
      if (savedKey) {
        activeUserApiKey = savedKey;
      }
    }

    statApiKeys.textContent = keys ? keys.length.toString() : "0";

    apiKeysTableBody.innerHTML = "";
    if (!keys || keys.length === 0) {
      apiKeysTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">No active API keys found. Generate one to connect clients.</td></tr>`;
      return;
    }

    keys.forEach(key => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td><code>${key.key_prefix}...</code></td>
        <td><strong>${escapeHtml(key.label)}</strong></td>
        <td>${new Date(key.created_at).toLocaleDateString()} ${new Date(key.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
        <td>${key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : "Never"}</td>
        <td><button class="btn danger small btn-revoke-key" data-id="${key.id}">Revoke</button></td>
      `;
      apiKeysTableBody.appendChild(row);
    });

    // Revoke Handlers
    document.querySelectorAll(".btn-revoke-key").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const keyId = e.currentTarget.getAttribute("data-id");
        const confirmed = await customConfirm("Revoke API Key", "Are you sure you want to revoke this API key? This action cannot be undone.", "Revoke Key");
        if (confirmed) {
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
      credentialsListContainer.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:24px;">No credentials saved in vault.</div>`;
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
        <button class="btn danger small btn-delete-cred" data-id="${cred.id}">Delete</button>
      `;
      credentialsListContainer.appendChild(card);
    });

    document.querySelectorAll(".btn-delete-cred").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const id = e.currentTarget.getAttribute("data-id");
        const confirmed = await customConfirm("Delete Credential", "Delete these credentials from the vault? Connectors using this account will stop working.", "Delete");
        if (confirmed) {
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
    const [auditRes, usageRes] = await Promise.all([
      supabase
        .from("audit_log")
        .select("created_at, action, metadata")
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("usage_logs")
        .select("*", { count: "exact", head: true })
        .eq("user_id", currentUser.id)
        .gte("created_at", new Date(new Date().setHours(0,0,0,0)).toISOString())
    ]);

    if (auditRes.error) throw auditRes.error;
    const audits = auditRes.data;

    // Recent console output
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

    // Security Audit table
    auditLogsTableBody.innerHTML = "";
    if (!audits || audits.length === 0) {
      auditLogsTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding:16px;">No audit trail recorded yet.</td></tr>`;
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

    // Rate Limit display
    const requestCount = usageRes.count || 0;
    statRateLimit.textContent = `${requestCount} / 10,000`;
  } catch (err) {
    console.error("Failed to load system logs", err);
  }
}

function loadConnectorStatuses() {
  connectorsStatusTable.innerHTML = `
    <tr>
      <td><code>mt5</code></td>
      <td><strong>MetaTrader 5 Bridge</strong></td>
      <td>Read-Only Gateway</td>
      <td><span class="badge active">ACTIVE</span></td>
    </tr>
    <tr>
      <td><code>bybit</code></td>
      <td><strong>Bybit Perpetual</strong></td>
      <td>Stateful Management</td>
      <td><span class="badge active">ACTIVE</span></td>
    </tr>
  `;
}

// --- Credential Vault Operations ---

async function handleVaultSubmission(e) {
  e.preventDefault();
  vaultSuccess.classList.add("hidden");
  vaultErrorMsg.classList.add("hidden");

  if (!activeUserApiKey) {
    const inputKey = await customPromptApiKey();
    if (!inputKey) {
      showToast("Authorization Required", "An API Key is required to encrypt and upload credentials.", "warning");
      return;
    }
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
      body: JSON.stringify({ label, credentials: credentialsObj })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gateway upload error [${res.status}]: ${errText}`);
    }

    const data = await res.json();
    if (data.success) {
      vaultSuccess.classList.remove("hidden");
      vaultForm.reset();
      showToast("Vault Updated", "Credentials encrypted and saved securely.", "success");
      await Promise.all([loadVaultCredentials(), loadAuditAndUsageLogs()]);
    } else {
      throw new Error(data.error || "Gateway rejected credentials upload");
    }
  } catch (err) {
    showVaultError(err.message);
    showToast("Upload Failed", err.message, "error");
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

    await supabase.from("audit_log").insert({
      user_id: currentUser.id,
      action: "credential_deleted",
      metadata: { credential_id: id }
    });

    showToast("Deleted", "Credentials removed from vault.", "info");
    await Promise.all([loadVaultCredentials(), loadAuditAndUsageLogs()]);
  } catch (err) {
    showToast("Delete Error", err.message, "error");
  }
}

// --- API Key Operations ---

async function handleApiKeyGeneration(e) {
  e.preventDefault();
  const label = keyLabel.value.trim();

  // Generate cryptographically secure random key with new Sentinal-MCP prefix "smc_"
  const prefix = "smc_";
  const randBytes = crypto.getRandomValues(new Uint8Array(20));
  const hexKey = Array.from(randBytes).map(b => b.toString(16).padStart(2, "0")).join("");
  const rawKey = prefix + hexKey;

  // SHA-256 Digest
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const keyHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  const keyPrefix = rawKey.substring(0, 8);

  try {
    const { error } = await supabase.from("api_keys").insert({
      user_id: currentUser.id,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      label: label
    });

    if (error) throw error;

    await supabase.from("audit_log").insert({
      user_id: currentUser.id,
      action: "api_key_generated",
      metadata: { label, prefix: keyPrefix }
    });

    // Save in localStorage under new sentinel namespace
    localStorage.setItem(`sentinel_raw_key_${keyPrefix}`, rawKey);
    activeUserApiKey = rawKey;

    newKeyDisplay.textContent = rawKey;
    keyModal.classList.remove("hidden");
    keyGenerationForm.reset();

    showToast("API Key Generated", "Copy your key before closing the modal.", "success");
    await Promise.all([loadApiKeys(), loadAuditAndUsageLogs()]);
  } catch (err) {
    showToast("Generation Error", err.message, "error");
  }
}

async function revokeApiKey(id) {
  try {
    const { error } = await supabase
      .from("api_keys")
      .update({ revoked: true })
      .eq("id", id);

    if (error) throw error;

    await supabase.from("audit_log").insert({
      user_id: currentUser.id,
      action: "api_key_revoked",
      metadata: { key_id: id }
    });

    showToast("Key Revoked", "API Key deactivated successfully.", "info");
    await Promise.all([loadApiKeys(), loadAuditAndUsageLogs()]);
  } catch (err) {
    showToast("Revoke Error", err.message, "error");
  }
}

function copyKeyToClipboard() {
  navigator.clipboard.writeText(newKeyDisplay.textContent);
  btnCopyKey.textContent = "Copied!";
  showToast("Copied to Clipboard", "API Key copied safely.", "info");
  setTimeout(() => btnCopyKey.textContent = "Copy", 1800);
}

// --- Trading Bot Operations ---

async function loadBotSettingsAndStates() {
  try {
    const [tgRes, presetRes, stateRes] = await Promise.all([
      supabase.from("telegram_settings").select("telegram_chat_id").eq("user_id", currentUser.id),
      supabase.from("trading_presets").select("symbol, tp_distance_pct, exit_strategy, trailing_stop_pct").eq("user_id", currentUser.id),
      supabase.from("trading_states").select("symbol, state, bias_direction, position_taken_over").eq("user_id", currentUser.id)
    ]);

    // 1. Telegram settings
    if (tgRes.data && tgRes.data.length > 0) {
      tgChatIdInput.value = tgRes.data[0].telegram_chat_id;
      if (btnUnlinkTg) btnUnlinkTg.classList.remove("hidden");
      tgStatusMessage.className = "tg-status-box linked";
      tgStatusMessage.innerHTML = `✓ <strong>LINKED</strong> to Telegram Chat ID: <code>${tgRes.data[0].telegram_chat_id}</code>`;
    } else {
      tgChatIdInput.value = "";
      if (btnUnlinkTg) btnUnlinkTg.classList.add("hidden");
      tgStatusMessage.className = "tg-status-box";
      tgStatusMessage.innerHTML = `No Telegram chat linked. Start the bot on Telegram and register with your API Key to link.`;
    }

    // 2. Map presets and state machines
    const symbolMap = new Map();
    if (presetRes.data) {
      presetRes.data.forEach(p => symbolMap.set(p.symbol.toUpperCase(), { preset: p, state: null }));
    }
    if (stateRes.data) {
      stateRes.data.forEach(s => {
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
      botStatesTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">No active presets or state machine symbols.</td></tr>`;
      return;
    }

    symbolMap.forEach((val, sym) => {
      const row = document.createElement("tr");

      const presetText = val.preset
        ? `<code>${val.preset.tp_distance_pct}%</code> / <code>${val.preset.exit_strategy.toUpperCase()}</code>`
        : `<span style="color:var(--text-muted);">None</span>`;

      const stateText = val.state ? `<code>${val.state.state}</code>` : `<code>IDLE</code>`;

      const dirClass = val.state?.bias_direction === "LONG" ? "long" : val.state?.bias_direction === "SHORT" ? "short" : "inactive";
      const dirText = val.state?.bias_direction ? `<span class="badge ${dirClass}">${val.state.bias_direction}</span>` : `<span class="badge inactive">NONE</span>`;

      row.innerHTML = `
        <td><strong>${sym}</strong></td>
        <td>${presetText}</td>
        <td>${stateText}</td>
        <td>${dirText}</td>
        <td>
          <div style="display:flex; gap:6px;">
            ${val.state && val.state.state !== "IDLE" ? `<button class="btn secondary small btn-reset-bot" data-symbol="${sym}">Reset State</button>` : ""}
            ${val.preset ? `<button class="btn danger small btn-delete-preset" data-symbol="${sym}">Delete</button>` : ""}
          </div>
        </td>
      `;
      botStatesTableBody.appendChild(row);
    });

    document.querySelectorAll(".btn-reset-bot").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const sym = e.currentTarget.getAttribute("data-symbol");
        const confirmed = await customConfirm("Reset Bot State", `Reset state machine for ${sym} to IDLE?`, "Reset");
        if (confirmed) await resetBotState(sym);
      });
    });

    document.querySelectorAll(".btn-delete-preset").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const sym = e.currentTarget.getAttribute("data-symbol");
        const confirmed = await customConfirm("Delete Preset", `Delete trading preset for ${sym}?`, "Delete");
        if (confirmed) await deletePreset(sym);
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
    showToast("State Reset", `${symbol} state reset to IDLE.`, "info");
    await loadBotSettingsAndStates();
  } catch (err) {
    showToast("Reset Failed", err.message, "error");
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
    showToast("Preset Removed", `Preset for ${symbol} deleted.`, "info");
    await loadBotSettingsAndStates();
  } catch (err) {
    showToast("Delete Failed", err.message, "error");
  }
}

async function handleUnlinkTelegram() {
  const confirmed = await customConfirm("Unlink Telegram", "Unlink your Telegram account? You will stop receiving signals and alerts.", "Unlink");
  if (confirmed) {
    try {
      const { error } = await supabase
        .from("telegram_settings")
        .delete()
        .eq("user_id", currentUser.id);

      if (error) throw error;
      showToast("Unlinked", "Telegram integration removed.", "info");
      await loadBotSettingsAndStates();
    } catch (err) {
      showToast("Unlink Error", err.message, "error");
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
    showToast("Preset Saved", `Preset for ${symbol} configured successfully.`, "success");
    await loadBotSettingsAndStates();
  } catch (err) {
    presetError.classList.remove("hidden");
    presetError.textContent = `Save failed: ${err.message}`;
    showToast("Save Error", err.message, "error");
  }
}

// --- Settings Handler ---
function handleSaveSettings() {
  const url = cfgSbUrl.value.trim();
  const key = cfgSbKey.value.trim();
  const gt = cfgGtUrl.value.trim();

  if (url) {
    localStorage.setItem("SENTINEL_SUPABASE_URL", url);
    localStorage.setItem("BASTION_SUPABASE_URL", url);
  }
  if (key) {
    localStorage.setItem("SENTINEL_SUPABASE_ANON_KEY", key);
    localStorage.setItem("BASTION_SUPABASE_ANON_KEY", key);
  }
  if (gt) {
    localStorage.setItem("SENTINEL_GATEWAY_URL", gt);
    localStorage.setItem("BASTION_GATEWAY_URL", gt);
  }

  if (cfgSaveMsg) cfgSaveMsg.classList.remove("hidden");
  showToast("Settings Saved", "Reloading application to establish new connection…", "success");
  setTimeout(() => window.location.reload(), 1200);
}

// --- Utility Functions ---
function escapeHtml(text) {
  if (typeof text !== "string") return JSON.stringify(text);
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Initialize on DOM Ready
document.addEventListener("DOMContentLoaded", init);
