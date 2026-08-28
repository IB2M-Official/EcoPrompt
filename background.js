/**
 * background.js  –  EcoPrompt v1.1.0  (Service Worker – Module)
 *
 * Responsabilites :
 *   - Enregistrement des usages (ECO_RECORD) : water_ml, wh, co2_g, cost_eur,
 *     text_count, thinking_count, image_count.
 *   - Bilan quotidien a 08h30 via chrome.alarms.
 *   - Bilan mensuel le 1er de chaque mois.
 *   - Notifications natives avec metriques CO2 et equivalent voiture.
 */

const ALARM_DAILY   = "ecoprompt_daily";
const ALARM_MONTHLY = "ecoprompt_monthly";

// ─── Cycle de vie ────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install" || reason === "update") await setupAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  await setupAlarms();
  await checkAndNotifyDaily();
});

// ─── Alarmes ─────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_DAILY)   await checkAndNotifyDaily();
  if (alarm.name === ALARM_MONTHLY) await notifyMonthly();
});

// ─── Messages depuis content.js ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.type === "ECO_RECORD") {
    recordUsage(msg.payload).then(() => respond({ ok: true }));
    return true; // reponse asynchrone
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Alarmes
// ────────────────────────────────────────────────────────────────────────────

async function setupAlarms() {
  // Alarme quotidienne a 08h30
  if (!(await chrome.alarms.get(ALARM_DAILY))) {
    const now   = new Date();
    const next  = new Date(now);
    next.setHours(8, 30, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delayMins = Math.max(1, Math.floor((next - now) / 60_000));
    chrome.alarms.create(ALARM_DAILY, { delayInMinutes: delayMins, periodInMinutes: 1440 });
  }
  // Alarme mensuelle (verification toutes les 24h)
  if (!(await chrome.alarms.get(ALARM_MONTHLY))) {
    chrome.alarms.create(ALARM_MONTHLY, { delayInMinutes: 2, periodInMinutes: 1440 });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Stockage
// ────────────────────────────────────────────────────────────────────────────

/**
 * Enregistre une requete dans chrome.storage.local.
 * Structure de chaque entree :
 * {
 *   water_ml, wh, co2_g, cost_eur,
 *   text_count, thinking_count, image_count,
 *   by_provider: { [provider]: { same fields } }
 * }
 *
 * Cles de stockage :
 *   "usage_YYYY-MM-DD"   : bilan journalier
 *   "usage_YYYY-MM"      : bilan mensuel
 *   "usage_week_YYYY-WNN": bilan hebdomadaire
 */
async function recordUsage(payload) {
  const todayKey = getTodayKey();
  const monthKey = getMonthKey();
  const weekKey  = getWeekKey();

  const keys   = [todayKey, monthKey, weekKey];
  const stored = await chrome.storage.local.get(keys);

  for (const key of keys) {
    const entry = stored[key] ?? createEmpty();

    entry.water_ml       = (Number(entry.water_ml)       || 0) + (Number(payload.water_ml)  || 0);
    entry.wh             = (Number(entry.wh)             || 0) + (Number(payload.wh)         || 0);
    entry.co2_g          = (Number(entry.co2_g)          || 0) + (Number(payload.co2_g)      || 0);
    entry.cost_eur       = (Number(entry.cost_eur)       || 0) + (Number(payload.cost_eur)   || 0);
    entry.text_count     = (Number(entry.text_count)     || 0) + ((!payload.is_image && !payload.is_thinking) ? 1 : 0);
    entry.thinking_count = (Number(entry.thinking_count) || 0) + (payload.is_thinking ? 1 : 0);
    entry.image_count    = (Number(entry.image_count)    || 0) + (payload.is_image    ? 1 : 0);

    // Ventilation par fournisseur
    if (!entry.by_provider) entry.by_provider = {};
    const prov = entry.by_provider[payload.provider] ?? createEmpty();
    prov.water_ml       = (Number(prov.water_ml)       || 0) + (Number(payload.water_ml)  || 0);
    prov.wh             = (Number(prov.wh)             || 0) + (Number(payload.wh)         || 0);
    prov.co2_g          = (Number(prov.co2_g)          || 0) + (Number(payload.co2_g)      || 0);
    prov.cost_eur       = (Number(prov.cost_eur)       || 0) + (Number(payload.cost_eur)   || 0);
    prov.text_count     = (Number(prov.text_count)     || 0) + ((!payload.is_image && !payload.is_thinking) ? 1 : 0);
    prov.thinking_count = (Number(prov.thinking_count) || 0) + (payload.is_thinking ? 1 : 0);
    prov.image_count    = (Number(prov.image_count)    || 0) + (payload.is_image    ? 1 : 0);
    entry.by_provider[payload.provider] = prov;

    stored[key] = entry;
  }

  stored["last_activity_date"] = todayKey;
  await chrome.storage.local.set(stored);
}

// ────────────────────────────────────────────────────────────────────────────
// Notifications
// ────────────────────────────────────────────────────────────────────────────

async function checkAndNotifyDaily() {
  const yKey = getYesterdayKey();
  const store = await chrome.storage.local.get([yKey, "last_notified_daily"]);
  const entry = store[yKey];

  if (store["last_notified_daily"] === yKey) return;
  if (!entry || totalRequests(entry) === 0) return;

  const total    = totalRequests(entry);
  const whFmt    = entry.wh < 1
    ? `${(entry.wh * 1000).toFixed(0)} mWh`
    : `${entry.wh.toFixed(2)} Wh`;
  const co2Fmt   = `${entry.co2_g.toFixed(2)} g`;
  const carMFmt  = entry.co2_g >= 120
    ? ` (~${(entry.co2_g / 120).toFixed(1)} km en voiture)`
    : "";
  const waterFmt = entry.water_ml >= 1000
    ? `${(entry.water_ml / 1000).toFixed(2)} L`
    : `${entry.water_ml.toFixed(0)} mL`;

  await chrome.notifications.create("daily_" + yKey, {
    type:    "basic",
    iconUrl: "icons/icon48.png",
    title:   "\u2600\ufe0f Bilan EcoPrompt d hier",
    message: `${total} requ\u00eate${total > 1 ? "s" : ""}\u00a0: ${whFmt} \u26a1, ${co2Fmt} CO\u2082${carMFmt}, ${waterFmt} \uD83D\uDCA7.`,
    priority: 1,
  });

  await chrome.storage.local.set({ last_notified_daily: yKey });
}

async function notifyMonthly() {
  if (new Date().getDate() !== 1) return;

  const pmKey = getPrevMonthKey();
  const store = await chrome.storage.local.get([pmKey, "last_notified_monthly"]);
  const entry = store[pmKey];

  if (store["last_notified_monthly"] === pmKey) return;
  if (!entry || totalRequests(entry) === 0) return;

  const total    = totalRequests(entry);
  const co2Fmt   = entry.co2_g >= 1000
    ? `${(entry.co2_g / 1000).toFixed(2)} kg`
    : `${entry.co2_g.toFixed(1)} g`;
  const carMFmt  = entry.co2_g >= 120
    ? ` (\u2248 ${(entry.co2_g / 120).toFixed(0)} km en voiture)`
    : "";
  const costFmt  = `${entry.cost_eur.toFixed(2)} \u20ac`;

  await chrome.notifications.create("monthly_" + pmKey, {
    type:    "basic",
    iconUrl: "icons/icon48.png",
    title:   "\uD83D\uDCC5 Rapport mensuel EcoPrompt",
    message: `${total} requ\u00eates ce mois\u00a0: ${co2Fmt} CO\u2082${carMFmt}, ${costFmt} estim\u00e9s. Ouvrez l extension pour le d\u00e9tail.`,
    priority: 2,
  });

  await chrome.storage.local.set({ last_notified_monthly: pmKey });
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function createEmpty() {
  return {
    water_ml: 0, wh: 0, co2_g: 0, cost_eur: 0,
    text_count: 0, thinking_count: 0, image_count: 0,
    by_provider: {},
  };
}

function totalRequests(entry) {
  return (entry.text_count ?? 0) + (entry.thinking_count ?? 0) + (entry.image_count ?? 0);
}

function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2, "0"); }

function getTodayKey()     { return "usage_" + dateStr(new Date()); }
function getYesterdayKey() { const d = new Date(); d.setDate(d.getDate()-1); return "usage_" + dateStr(d); }
function getMonthKey()     { const d = new Date(); return `usage_${d.getFullYear()}-${pad(d.getMonth()+1)}`; }
function getPrevMonthKey() {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-1);
  return `usage_${d.getFullYear()}-${pad(d.getMonth()+1)}`;
}
function getWeekKey() {
  const d = new Date();
  const year = d.getFullYear();
  const w = getISOWeek(d);
  return `usage_week_${year}-W${pad(w)}`;
}
function getISOWeek(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - ((d.getDay()+6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay()+6)%7)) / 7);
}
