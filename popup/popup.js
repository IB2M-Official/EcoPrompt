/**
 * popup.js  –  EcoPrompt v1.5.0 Botanical Minimalist
 *
 * Lightweight popup view displaying essential today's stats + instant link to Full Dashboard.
 */

const DONATION_URL = "https://ko-fi.com/ib2m_official";

document.addEventListener("DOMContentLoaded", () => {
  // Donation button
  document.getElementById("donate-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: DONATION_URL });
  });

  // Open Full Dashboard button & Quick icon
  const openDashboard = (e) => {
    e?.preventDefault?.();
    const url = chrome.runtime.getURL("dashboard/dashboard.html");
    chrome.tabs.create({ url });
  };

  document.getElementById("open-dash-btn")?.addEventListener("click", openDashboard);
  document.getElementById("quick-dash-btn")?.addEventListener("click", openDashboard);

  // Set today's date formatted
  const dateEl = document.getElementById("today-date");
  if (dateEl) {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }

  // Load and render
  refresh();
});

// Real-time synchronization
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const affectsToday = Object.keys(changes).some((k) => k.startsWith("usage_"));
  if (affectsToday) refresh();
});

async function refresh() {
  const todayKey = "usage_" + dateStr(new Date());
  const stored = await chrome.storage.local.get(todayKey);
  const data = stored[todayKey] || {
    water_ml: 0,
    wh: 0,
    co2_g: 0,
    cost_eur: 0,
    text_count: 0,
    thinking_count: 0,
    image_count: 0,
  };

  const totalReqs = (data.text_count ?? 0) + (data.thinking_count ?? 0) + (data.image_count ?? 0);

  // Prompts
  setText("kpi-prompts", String(totalReqs));
  setText("equiv-prompts", totalReqs === 0 ? "No requests today" : totalReqs === 1 ? "1 request sent today" : `${totalReqs} requests sent today`);

  // CO2
  setText("kpi-co2", fmtCo2(data.co2_g));
  setText("equiv-co2", equivCo2(data.co2_g));

  // Water
  setText("kpi-water", fmtWater(data.water_ml));
  setText("equiv-water", equivWater(data.water_ml));

  // Energy
  setText("kpi-energy", fmtEnergy(data.wh));
  setText("equiv-energy", equivEnergy(data.wh));

  // Cost
  setText("kpi-cost", fmtCost(data.cost_eur));
  setText("equiv-cost", data.cost_eur > 0 ? "≈ API rate" : "0.00 €");
}

function fmtCo2(g) {
  if (!g || g === 0) return "0.0 g";
  if (g >= 1000) return (g / 1000).toFixed(2) + " kg";
  if (g >= 1) return g.toFixed(1) + " g";
  return (g * 1000).toFixed(0) + " mg";
}

function equivCo2(g) {
  if (!g || g === 0) return "0 km car";
  if (g >= 120) return `≈ ${(g / 120).toFixed(1)} km car`;
  if (g >= 8) return `≈ ${Math.round(g / 8)} charges`;
  return "< 1 charge";
}

function fmtWater(ml) {
  if (!ml || ml === 0) return "0.0 mL";
  if (ml >= 1000) return (ml / 1000).toFixed(2) + " L";
  if (ml >= 1) return ml.toFixed(1) + " mL";
  return (ml * 1000).toFixed(0) + " µL";
}

function equivWater(ml) {
  if (!ml || ml === 0) return "0 glasses";
  if (ml >= 250) return `≈ ${(ml / 250).toFixed(1)} glasses`;
  if (ml >= 150) return `≈ ${(ml / 150).toFixed(1)} teas`;
  return "< 1 tea";
}

function fmtEnergy(wh) {
  if (!wh || wh === 0) return "0.0 Wh";
  if (wh >= 1000) return (wh / 1000).toFixed(2) + " kWh";
  if (wh >= 1) return wh.toFixed(1) + " Wh";
  return (wh * 1000).toFixed(0) + " mWh";
}

function equivEnergy(wh) {
  if (!wh || wh === 0) return "0 min LED";
  if (wh >= 10) return `≈ ${Math.round((wh / 80) * 3600)}s TV`;
  if (wh > 0) return `≈ ${Math.round((wh / 0.008) * 60)}m LED`;
  return "< 1m LED";
}

function fmtCost(eur) {
  if (!eur || eur === 0) return "0.00 €";
  if (eur >= 1) return eur.toFixed(2) + " €";
  if (eur >= 0.01) return eur.toFixed(3) + " €";
  if (eur >= 0.001) return (eur * 100).toFixed(2) + " c€";
  return "< 0.001 €";
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function dateStr(d) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}
