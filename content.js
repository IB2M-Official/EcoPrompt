/**
 * content.js  –  EcoPrompt v1.5.0
 *
 * Intercepts prompt submissions on ChatGPT, Gemini and Claude.
 * Every prompt is recorded as a unified standard request.
 * Length-based weighting still applies (×1.3 >1 000 chars, ×1.8 >3 000 chars).
 * v1.2.0: Daily quota checking.
 * v1.3.0: Ultra-compact popup + Full standalone Dashboard + context guard fixes.
 * v1.4.0: Continuous progressive alerts (+1, +2...) on every prompt meeting or exceeding quota.
 * v1.5.0: Botanical Minimalist theme (Earth, Linen & Forest Green) with enhanced contrast.
 */

// ────────────────────────────────────────────────────────────────────────────
// Model data (inline — no ES imports allowed in content scripts)
// Standard tier only: ~2 Wh | ~22 mL | ~0.60 g CO₂ | ~0.003 €
// ────────────────────────────────────────────────────────────────────────────

const MODEL_DATA = {
  openai:    { wh: 2.0, water_ml: 22, co2_g: 0.60, cost_eur: 0.003, label: "ChatGPT" },
  google:    { wh: 2.0, water_ml: 22, co2_g: 0.60, cost_eur: 0.003, label: "Gemini" },
  anthropic: { wh: 2.0, water_ml: 22, co2_g: 0.60, cost_eur: 0.003, label: "Claude" },
};

// ────────────────────────────────────────────────────────────────────────────
// Selecteurs DOM
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// DOM selectors
// ────────────────────────────────────────────────────────────────────────────

/** Input area selectors, in priority order. */
const INPUT_SELECTORS = {
  openai: [
    "#prompt-textarea",
    "div[data-testid='composer-input']",
    "textarea[data-id='root']",
    "div[contenteditable='true'][data-testid]",
  ],
  google: [
    "rich-textarea div[contenteditable='true']",
    "rich-textarea textarea",
    "div.ql-editor[contenteditable='true']",
    "div[contenteditable='true'][aria-label]",
  ],
  anthropic: [
    "div.ProseMirror[contenteditable='true']",
    "div[contenteditable='true'][aria-label*='Claude' i]",
    "fieldset div[contenteditable='true']",
    "div[contenteditable='true']",
  ],
};

/** Send-button selectors. */
const SEND_BUTTON_SELECTORS = {
  openai: [
    "button[data-testid='send-button']",
    "button[data-testid='composer-send-button']",
    "button[aria-label*='Send' i]",
    "button[aria-label*='Envoyer' i]",
  ],
  google: [
    "button.send-button",
    "button[aria-label*='Send' i]",
    "button[aria-label*='Envoyer' i]",
    "button[data-tooltip*='Send' i]",
    "button[data-tooltip*='Envoyer' i]",
    "button.mat-mdc-tooltip-trigger",
  ],
  anthropic: [
    "button[aria-label*='Send' i]",
    "button[aria-label*='Envoyer' i]",
    "button[data-testid*='send' i]",
    "fieldset button:last-of-type",
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// Hostname → provider mapping
// ────────────────────────────────────────────────────────────────────────────

const DOMAIN_MAP = {
  "chatgpt.com":       "openai",
  "chat.openai.com":   "openai",
  "gemini.google.com": "google",
  "claude.ai":         "anthropic",
};

function resolveProvider() {
  const h = window.location.hostname;
  for (const [domain, prov] of Object.entries(DOMAIN_MAP)) {
    if (h.includes(domain)) return prov;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Prompt-length weighting
// ────────────────────────────────────────────────────────────────────────────

function getLengthFactor(charCount) {
  if (charCount >= 3000) return 1.8;
  if (charCount >= 1000) return 1.3;
  return 1.0;
}

// ────────────────────────────────────────────────────────────────────────────
// Initialisation
// ────────────────────────────────────────────────────────────────────────────

(function init() {
  const provider = resolveProvider();
  if (!provider) return;

  console.log("[EcoPrompt] Active on:", window.location.hostname, "| provider:", provider);

  injectToastStyles();
  attachGlobalListeners(provider);
})();

// ────────────────────────────────────────────────────────────────────────────
// Global listeners (window, capture:true)
// ────────────────────────────────────────────────────────────────────────────

let lastSubmitTimestamp = 0;
const DEBOUNCE_MS = 1_200;

function attachGlobalListeners(provider) {
  const sendSelectors = SEND_BUTTON_SELECTORS[provider];

  // Keyboard: Enter key
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    const t = e.target;
    const isEditable =
      t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable;
    if (isEditable) handleSubmit(provider);
  }, { capture: true });

  // Mouse: click on send button
  window.addEventListener("click", (e) => {
    const matched = sendSelectors.some((sel) => {
      try { return !!e.target.closest(sel); } catch (_) { return false; }
    });
    if (matched) handleSubmit(provider);
  }, { capture: true });
}

// ────────────────────────────────────────────────────────────────────────────
// Submit handler
// ────────────────────────────────────────────────────────────────────────────

function handleSubmit(provider) {
  // Guard: bail out immediately if the extension context has been invalidated
  if (typeof chrome === "undefined" || !chrome.runtime?.id) return;

  const now = Date.now();
  if (now - lastSubmitTimestamp < DEBOUNCE_MS) {
    console.log("[EcoPrompt] Debounce skipped (" + (now - lastSubmitTimestamp) + " ms)");
    return;
  }
  lastSubmitTimestamp = now;

  const promptText = (extractText(provider) || "").trim();
  if (!promptText) {
    return;
  }

  const charCount = promptText.length;
  const lenFactor = getLengthFactor(charCount);
  const base      = MODEL_DATA[provider];
  if (!base) return;

  // Length coefficient applied to wh and co2_g only
  const wh       = base.wh     * lenFactor;
  const co2_g    = base.co2_g  * lenFactor;
  const water_ml = base.water_ml; // water not multiplied (fixed cooling overhead)
  const cost_eur = base.cost_eur;
  const kwh      = wh / 1000;

  console.log("[EcoPrompt] Prompt intercepted:", promptText.slice(0, 80) + (charCount > 80 ? "..." : ""),
    "| provider:", provider, "| factor:", lenFactor.toFixed(1));

  const payload = {
    provider,
    tier: "standard",
    wh, kwh, water_ml, co2_g, cost_eur,
    is_image:    false,
    is_thinking: false,
  };

  // Defensive send — guards against "Extension context invalidated"
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    try {
      chrome.runtime.sendMessage({ type: "ECO_RECORD", payload }, (response) => {
        if (chrome.runtime?.lastError) {
          // Service Worker waking up, or context already expired — expected.
        }
      });
    } catch (e) {
      console.warn("[EcoPrompt] Extension context expired — please refresh the page (F5).");
    }
  }
  showToast({ wh, water_ml, co2_g, cost_eur, label: base.label });

  // v1.2.0: check daily quota after recording
  checkQuotaAlert({ wh, water_ml, co2_g });
}


// ────────────────────────────────────────────────────────────────────────────
// Dynamic text extraction
// ────────────────────────────────────────────────────────────────────────────

function extractText(provider) {
  try {
    // 1. Priorité à l'élément actif sous le curseur
    const active = document.activeElement;
    if (active) {
      if (active.tagName === "TEXTAREA" || active.tagName === "INPUT") {
        const v = (active.value || "").trim();
        if (v) return v;
      } else if (active.isContentEditable) {
        const t = (active.innerText || active.textContent || "").trim();
        if (t) return t;
      }
    }

    // 2. Recherche via les sélecteurs du fournisseur
    const selectors = INPUT_SELECTORS[provider] || [];
    for (const sel of selectors) {
      let el = null;
      try { el = document.querySelector(sel); } catch (_) { continue; }
      if (!el) continue;

      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        const v = (el.value || "").trim();
        if (v) return v;
      }
      const t = (el.innerText || el.textContent || "").trim();
      if (t) return t;
    }
  } catch (err) {
    console.warn("[EcoPrompt] extractText error:", err);
  }

  // Fallback obligatoire : toujours retourner une chaîne vide et jamais undefined
  return "";
}

// ────────────────────────────────────────────────────────────────────────────
// Floating toast — design v1.1.0
// ────────────────────────────────────────────────────────────────────────────

function showToast(data) {
  document.getElementById("eco-toast")?.remove();

  // Format metrics
  const whFmt = data.wh < 1
    ? `${(data.wh * 1000).toFixed(0)} mWh`
    : `${data.wh.toFixed(2)} Wh`;

  const waterFmt = data.water_ml >= 1000
    ? `${(data.water_ml / 1000).toFixed(2)} L`
    : `${data.water_ml.toFixed(1)} mL`;

  const co2Fmt = data.co2_g >= 1
    ? `${data.co2_g.toFixed(2)} g`
    : `${(data.co2_g * 1000).toFixed(0)} mg`;

  const costFmt = data.cost_eur < 0.001
    ? `< 0.001 \u20ac`
    : data.cost_eur < 0.01
      ? `${(data.cost_eur * 100).toFixed(3)} c\u20ac`
      : `${data.cost_eur.toFixed(4)} \u20ac`;

  const toast = document.createElement("div");
  toast.id = "eco-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.innerHTML = `
    <div class="eco-header">
      <span class="eco-brand">\uD83C\uDF31 EcoPrompt</span>
      <span class="eco-badge mode-std">\uD83D\uDCAC Prompt</span>
    </div>
    <div class="eco-metrics">
      <span class="eco-metric water">\uD83D\uDCA7 ${waterFmt}</span>
      <span class="eco-metric energy">\u26A1 ${whFmt}</span>
      <span class="eco-metric co2">\uD83C\uDF43 ${co2Fmt} CO\u2082</span>
      <span class="eco-metric cost">\uD83D\uDCB6 ~${costFmt}</span>
    </div>
    <div class="eco-model">${data.label}</div>
  `;

  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add("eco-fade-out"), 3_500);
  setTimeout(() => toast.remove(), 4_200);
}

// ────────────────────────────────────────────────────────────────────────────
// Toast styles injection
// ────────────────────────────────────────────────────────────────────────────

function injectToastStyles() {
  if (document.getElementById("eco-toast-styles")) return;
  const style = document.createElement("style");
  style.id = "eco-toast-styles";
  style.textContent = `
    #eco-toast {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      min-width: 250px;
      max-width: 350px;
      padding: 13px 16px 11px;
      border-radius: 14px;
      background: rgba(253, 252, 250, 0.96);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(45, 90, 39, 0.22);
      box-shadow:
        0 0 0 1px rgba(45, 90, 39, 0.05),
        0 8px 30px rgba(0, 0, 0, 0.12),
        0 2px 10px rgba(45, 90, 39, 0.08);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #1E293B;
      animation: eco-in 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) both;
      pointer-events: none;
    }

    @keyframes eco-in {
      from { transform: translateX(115%) scale(0.88); opacity: 0; }
      to   { transform: translateX(0)     scale(1);   opacity: 1; }
    }

    #eco-toast.eco-fade-out {
      animation: eco-out 0.65s ease forwards;
    }

    @keyframes eco-out {
      from { opacity: 1; transform: translateX(0)    scale(1);    }
      to   { opacity: 0; transform: translateX(14px)  scale(0.95); }
    }

    .eco-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 9px;
    }

    .eco-brand {
      font-weight: 700;
      font-size: 11px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #2D5A27;
    }

    .eco-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 20px;
    }
    .mode-std   { background: #EDF4ED; color: #2D5A27; border: 1px solid #D1E3D0; }
    .mode-think { background: #F3E8FF; color: #7E22CE; border: 1px solid #E9D5FF; }
    .mode-image { background: #FEF3C7; color: #B45309; border: 1px solid #FDE68A; }

    .eco-metrics {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 10px;
      margin-bottom: 7px;
    }

    .eco-metric {
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .eco-metric.water  { color: #0284C7; }
    .eco-metric.energy { color: #D97706; }
    .eco-metric.co2    { color: #15803D; }
    .eco-metric.cost   { color: #475569; }

    .eco-model {
      font-size: 10px;
      color: #64748B;
      margin-top: 1px;
      font-weight: 500;
    }

    /* ── Quota alert toast (v1.5.0 Botanical Terracotta) ────────── */
    #eco-quota-toast {
      position: fixed;
      top: 115px;
      right: 20px;
      z-index: 2147483646;
      min-width: 260px;
      max-width: 360px;
      padding: 14px 16px 12px;
      border-radius: 14px;
      background: rgba(254, 242, 242, 0.97);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1.5px solid #FCA5A5;
      box-shadow:
        0 0 0 1px rgba(239, 68, 68, 0.1),
        0 8px 30px rgba(185, 28, 28, 0.15),
        0 2px 10px rgba(0, 0, 0, 0.08);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #991B1B;
      animation: eco-in 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) both;
      pointer-events: all;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    #eco-quota-toast.eco-fade-out {
      animation: eco-out 0.65s ease forwards;
      pointer-events: none;
    }

    .eco-quota-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .eco-quota-brand {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.03em;
      color: #991B1B;
    }

    .eco-quota-close {
      background: none;
      border: none;
      color: #B91C1C;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      padding: 0 4px;
      opacity: 0.8;
      transition: opacity 0.15s;
    }
    .eco-quota-close:hover { opacity: 1; }

    .eco-quota-detail {
      font-size: 11.5px;
      color: #7F1D1D;
      line-height: 1.45;
    }
  `;
  document.head.appendChild(style);
}

// ────────────────────────────────────────────────────────────────────────────
// v1.2.0 — Daily quota check
// ────────────────────────────────────────────────────────────────────────────

/**
 * Inline defaults (mirrors DEFAULT_SETTINGS from constants.js).
 * Content scripts cannot import ES modules.
 */
const QUOTA_DEFAULTS = {
  limit_enabled: true,
  limit_metric:  "prompts",
  limit_value:   15,
};

/** Conversion: 1 standard prompt = these values. */
const QUOTA_PROMPT_EQUIV = { wh: 2.0, water_ml: 22, co2_g: 0.60 };

/**
 * Called after every prompt recording.
 * Reads user_settings + today's usage from chrome.storage.local.
 * If the configured metric exceeds the limit and the alert has not yet
 * been shown today, fires showQuotaToast() and saves the flag.
 *
 * @param {{ wh: number, water_ml: number, co2_g: number,
 *            is_image: boolean, is_thinking: boolean }} incoming
 */
async function checkQuotaAlert(incoming) {
  // Guard: bail out if the extension context has been invalidated
  if (typeof chrome === "undefined" || !chrome.runtime?.id || !chrome.storage?.local) return;
  try {
    const todayKey = "usage_" + _quotaDateStr(new Date());
    const stored   = await chrome.storage.local.get(["user_settings", todayKey]);
    const settings = Object.assign({}, QUOTA_DEFAULTS, stored["user_settings"] ?? {});

    if (!settings.limit_enabled) return;

    const today = stored[todayKey] ?? {};
    const limit = Number(settings.limit_value) || QUOTA_DEFAULTS.limit_value;
    const metric = settings.limit_metric;

    let current = 0;
    if (metric === "prompts") {
      current = ((today.text_count ?? 0) + (today.thinking_count ?? 0) + (today.image_count ?? 0));
    } else if (metric === "co2") {
      current = Number(today.co2_g) || 0;
    } else if (metric === "water") {
      current = Number(today.water_ml) || 0;
    } else if (metric === "energy") {
      current = Number(today.wh) || 0;
    }

    if (current >= limit) {
      const unitLabel = { prompts: "prompts", co2: "g CO₂", water: "mL", energy: "Wh" }[metric];
      showQuotaToast(current, limit, unitLabel, metric);
    }
  } catch (err) {
    if (err?.message?.includes("Extension context invalidated")) return;
    console.warn("[EcoPrompt] Quota check failed:", err);
  }
}

/**
 * Displays a dismissible red toast for 6 seconds on every prompt meeting or exceeding quota.
 *
 * @param {number} current
 * @param {number} limit
 * @param {string} unit
 * @param {string} metric
 */
function showQuotaToast(current, limit, unit, metric) {
  document.getElementById("eco-quota-toast")?.remove();

  const isExactOrFirst = current <= limit || Math.abs(current - limit) < 0.0001;
  const isPromptMetric = metric === "prompts";
  
  const curFmt = isPromptMetric ? Math.round(current) : current.toFixed(1);
  const limFmt = isPromptMetric ? Math.round(limit) : limit.toFixed(1);

  let title = "⚠️ Daily Quota Reached!";
  let detail = `${curFmt} / ${limFmt} ${unit} — Quota reached. Try batching upcoming prompts.`;

  if (!isExactOrFirst) {
    const diff = current - limit;
    const diffFmt = isPromptMetric ? `+${Math.round(diff)}` : `+${diff.toFixed(1)}`;
    title = `🚨 Over Quota (${diffFmt} ${unit})!`;
    detail = `Today: ${curFmt} / ${limFmt} ${unit}. Every extra query increases your footprint.`;
  }

  const toast = document.createElement("div");
  toast.id = "eco-quota-toast";
  toast.setAttribute("role", "alert");
  toast.setAttribute("aria-live", "assertive");

  toast.innerHTML = `
    <div class="eco-quota-header">
      <span class="eco-quota-brand">${title}</span>
      <button class="eco-quota-close" aria-label="Dismiss">\u00d7</button>
    </div>
    <div class="eco-quota-detail">
      ${detail}
    </div>
  `;

  document.body.appendChild(toast);

  // Dismiss button
  toast.querySelector(".eco-quota-close").addEventListener("click", () => {
    toast.classList.add("eco-fade-out");
    setTimeout(() => toast.remove(), 700);
  });

  // Auto-dismiss after 6 s
  setTimeout(() => {
    if (!toast.isConnected) return;
    toast.classList.add("eco-fade-out");
    setTimeout(() => toast.remove(), 700);
  }, 6_000);
}

function _quotaDateStr(d) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}


