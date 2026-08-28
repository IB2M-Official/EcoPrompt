/**
 * dashboard.js  –  EcoPrompt v1.5.0 Full Dashboard & Interactive Analytics
 *
 * Full featured dashboard for in-depth ecological/financial analytics with interactive
 * SVG timelines (Day, Week, Month, Year), quota settings, and creator guide.
 */

const PROVIDER_NAMES = {
  openai:    "ChatGPT",
  google:    "Gemini",
  anthropic: "Claude",
};

const DEFAULT_SETTINGS = {
  limit_enabled: true,
  limit_metric:  "prompts",
  limit_value:   15,
};

const PROMPT_EQUIV = {
  wh:       2.0,
  water_ml: 22,
  co2_g:    0.60,
};

const METRIC_RANGES = {
  prompts: [1,  100,  1,  15],
  co2:     [1,  50,   1,  10],
  water:   [10, 2000, 10, 500],
  energy:  [1,  200,  1,  30],
};

const METRIC_UNITS = {
  prompts: "prompts",
  co2:     "g CO₂",
  water:   "mL",
  energy:  "Wh",
};

// ── State ──────────────────────────────────────────────────────────
let currentPeriod      = "day";
let currentPlatform    = "all";
let currentTab         = "analytics";
let currentChartMetric = "prompts";
let cachedTimeSeries   = [];

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Tab routing
  document.querySelectorAll(".dash-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // Time period filters
  document.querySelectorAll("[data-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setActive(btn, "[data-period]");
      currentPeriod = btn.dataset.period;
      refresh();
    });
  });

  // Platform filters
  document.querySelectorAll("[data-platform]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setActive(btn, "[data-platform]");
      currentPlatform = btn.dataset.platform;
      refresh();
    });
  });

  // Chart Metric Selector
  document.querySelectorAll("[data-chart-metric]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setActive(btn, "[data-chart-metric]");
      currentChartMetric = btn.dataset.chartMetric;
      renderSVGChart(cachedTimeSeries, currentChartMetric, currentPeriod);
    });
  });

  // Quota Controls
  initQuotaControls();

  // Initial Load
  refresh();
});

// ── Real-Time Storage Listener ─────────────────────────────────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  const affectsStats = Object.keys(changes).some(
    (k) => k.startsWith("usage_") || k === "user_settings"
  );

  if (affectsStats) {
    refresh();
    if (currentTab === "quotas") refreshQuotaProgress();
  }
});

// ── Tab Switching ──────────────────────────────────────────────────
function switchTab(tabName) {
  currentTab = tabName;

  document.querySelectorAll(".dash-tab").forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });

  document.getElementById("tab-analytics").hidden = (tabName !== "analytics");
  document.getElementById("tab-quotas").hidden    = (tabName !== "quotas");
  document.getElementById("tab-guide").hidden     = (tabName !== "guide");

  if (tabName === "quotas") refreshQuotaProgress();
  if (tabName === "analytics") refresh();
}

// ── Load & Render Analytics Data ───────────────────────────────────
async function refresh() {
  const { totals, timeSeries } = await loadAnalyticsDataset(currentPeriod, currentPlatform);
  cachedTimeSeries = timeSeries;
  renderAnalytics(totals);
  renderPeriodInfo(currentPeriod, currentPlatform);
  renderSVGChart(timeSeries, currentChartMetric, currentPeriod);
}

/**
 * Loads both aggregated totals and fine-grained time series for chart rendering.
 */
async function loadAnalyticsDataset(period, platform) {
  const totals = {
    water_ml: 0,
    wh: 0,
    co2_g: 0,
    cost_eur: 0,
    text_count: 0,
    thinking_count: 0,
    image_count: 0,
  };

  let timeSeries = [];
  const now = new Date();

  // 1. DAY (Today by provider breakdown)
  if (period === "day") {
    const key = "usage_" + dateStr(now);
    const stored = await chrome.storage.local.get(key);
    const entry = stored[key] || {};

    if (platform === "all") {
      mergeInto(totals, entry);
      const providers = [
        { id: "openai", name: "ChatGPT" },
        { id: "google", name: "Gemini" },
        { id: "anthropic", name: "Claude" }
      ];
      timeSeries = providers.map(p => {
        const pData = entry.by_provider?.[p.id] || {};
        return {
          label: p.name,
          prompts: (pData.text_count ?? 0) + (pData.thinking_count ?? 0) + (pData.image_count ?? 0),
          co2: Number(pData.co2_g) || 0,
          water: Number(pData.water_ml) || 0,
          energy: Number(pData.wh) || 0,
        };
      });
    } else {
      const pData = entry.by_provider?.[platform] || {};
      mergeInto(totals, pData);
      timeSeries = [{
        label: PROVIDER_NAMES[platform] || platform,
        prompts: (pData.text_count ?? 0) + (pData.thinking_count ?? 0) + (pData.image_count ?? 0),
        co2: Number(pData.co2_g) || 0,
        water: Number(pData.water_ml) || 0,
        energy: Number(pData.wh) || 0,
      }];
    }
  }

  // 2. WEEK (Last 7 Days)
  else if (period === "week") {
    const keys = [];
    const dateObjs = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      keys.push("usage_" + dateStr(d));
      dateObjs.push(d);
    }
    const stored = await chrome.storage.local.get(keys);

    timeSeries = keys.map((k, idx) => {
      const entry = stored[k] || {};
      const src = platform === "all" ? entry : (entry.by_provider?.[platform] || {});
      mergeInto(totals, src);
      const d = dateObjs[idx];
      return {
        label: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" }),
        fullDate: d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" }),
        prompts: (src.text_count ?? 0) + (src.thinking_count ?? 0) + (src.image_count ?? 0),
        co2: Number(src.co2_g) || 0,
        water: Number(src.water_ml) || 0,
        energy: Number(src.wh) || 0,
      };
    });
  }

  // 3. MONTH (Days of Current Month)
  else if (period === "month") {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const keys = [];
    const dateObjs = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), i);
      keys.push("usage_" + dateStr(d));
      dateObjs.push(d);
    }
    const stored = await chrome.storage.local.get(keys);

    timeSeries = keys.map((k, idx) => {
      const entry = stored[k] || {};
      const src = platform === "all" ? entry : (entry.by_provider?.[platform] || {});
      mergeInto(totals, src);
      const d = dateObjs[idx];
      return {
        label: String(d.getDate()),
        fullDate: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
        prompts: (src.text_count ?? 0) + (src.thinking_count ?? 0) + (src.image_count ?? 0),
        co2: Number(src.co2_g) || 0,
        water: Number(src.water_ml) || 0,
        energy: Number(src.wh) || 0,
      };
    });
  }

  // 4. YEAR (12 Months of Current Year)
  else if (period === "year") {
    const currentYear = now.getFullYear();
    const monthKeys = [];
    for (let m = 1; m <= 12; m++) {
      monthKeys.push(`usage_${currentYear}-${String(m).padStart(2, "0")}`);
    }

    const storedMonths = await chrome.storage.local.get(monthKeys);

    timeSeries = monthKeys.map((k, idx) => {
      const mDate = new Date(currentYear, idx, 1);
      const entry = storedMonths[k] || {};
      const src = platform === "all" ? entry : (entry.by_provider?.[platform] || {});
      mergeInto(totals, src);
      return {
        label: mDate.toLocaleDateString("en-GB", { month: "short" }),
        fullDate: mDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
        prompts: (src.text_count ?? 0) + (src.thinking_count ?? 0) + (src.image_count ?? 0),
        co2: Number(src.co2_g) || 0,
        water: Number(src.water_ml) || 0,
        energy: Number(src.wh) || 0,
      };
    });
  }

  return { totals, timeSeries };
}

// ── SVG Interactive Chart Engine ───────────────────────────────────
function renderSVGChart(dataset, metric, period) {
  const container = document.getElementById("chart-container");
  const subLabel  = document.getElementById("chart-sub-label");
  if (!container) return;

  const metricTitle = {
    prompts: "Prompts distribution",
    co2:     "Carbon footprint trend (g CO₂)",
    water:   "Water consumption trend (mL)",
    energy:  "Energy consumption trend (Wh)",
  }[metric] || "Distribution";

  if (subLabel) subLabel.textContent = metricTitle;

  if (!dataset || dataset.length === 0) {
    container.innerHTML = `<p class="chart-empty-msg">No timeline data available for this timeframe.</p>`;
    return;
  }

  // Values extraction
  const values = dataset.map(d => d[metric] || 0);
  const rawMax = Math.max(...values, 0);
  const maxVal = rawMax === 0 ? (metric === "prompts" ? 10 : 20) : rawMax * 1.15; // 15% headroom

  const width = container.clientWidth || 900;
  const height = 240;
  const padLeft = 46;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 34;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const count = dataset.length;
  const slotW = chartW / count;
  const barW = Math.max(6, Math.min(36, slotW * 0.62));

  // Horizontal Grid lines & Y axis ticks (4 levels)
  let gridLines = "";
  let yAxisLabels = "";
  const levels = 4;
  for (let i = 0; i <= levels; i++) {
    const yVal = (maxVal / levels) * i;
    const yPos = padTop + chartH - (i / levels) * chartH;
    
    // Grid line
    gridLines += `<line x1="${padLeft}" y1="${yPos}" x2="${width - padRight}" y2="${yPos}" class="chart-grid-line" />`;
    
    // Y label format
    let yFmt = "";
    if (metric === "prompts") yFmt = Math.round(yVal);
    else if (yVal >= 1000) yFmt = (yVal / 1000).toFixed(1) + "k";
    else yFmt = yVal >= 10 ? Math.round(yVal) : yVal.toFixed(1);

    yAxisLabels += `<text x="${padLeft - 8}" y="${yPos + 4}" text-anchor="end" class="chart-axis-label">${yFmt}</text>`;
  }

  // Bars and X-Labels
  let barsHTML = "";
  let xLabelsHTML = "";

  dataset.forEach((item, idx) => {
    const val = item[metric] || 0;
    const barH = (val / maxVal) * chartH;
    const xCenter = padLeft + idx * slotW + slotW / 2;
    const x = xCenter - barW / 2;
    const y = padTop + chartH - barH;

    // Show fewer X labels if month view has 31 items
    let showX = true;
    if (count > 20 && idx % 3 !== 0 && idx !== count - 1) {
      showX = false;
    }

    barsHTML += `
      <rect 
        class="chart-bar" 
        x="${x}" 
        y="${y}" 
        width="${barW}" 
        height="${Math.max(2, barH)}" 
        data-index="${idx}"
      />
    `;

    if (showX) {
      xLabelsHTML += `
        <text 
          x="${xCenter}" 
          y="${height - 10}" 
          text-anchor="middle" 
          class="chart-axis-label"
        >${item.label}</text>
      `;
    }
  });

  // SVG Assembly
  container.innerHTML = `
    <svg class="eco-chart-svg" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="ecoBarGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#4ADE80" />
          <stop offset="100%" stop-color="#16A34A" />
        </linearGradient>
        <linearGradient id="ecoBarHoverGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#38BDF8" />
          <stop offset="100%" stop-color="#0284C7" />
        </linearGradient>
      </defs>

      <!-- Grid -->
      ${gridLines}

      <!-- Axes -->
      <line x1="${padLeft}" y1="${padTop + chartH}" x2="${width - padRight}" y2="${padTop + chartH}" class="chart-axis-line" />
      ${yAxisLabels}
      ${xLabelsHTML}

      <!-- Bars -->
      ${barsHTML}
    </svg>
    <div class="chart-tooltip" id="chart-tooltip" style="opacity: 0;"></div>
  `;

  // Attach hover interactions for tooltip
  const tooltip = document.getElementById("chart-tooltip");
  const bars = container.querySelectorAll(".chart-bar");

  bars.forEach(bar => {
    bar.addEventListener("mouseenter", (e) => {
      const idx = Number(bar.dataset.index);
      const item = dataset[idx];
      if (!item || !tooltip) return;

      const val = item[metric] || 0;
      const unit = METRIC_UNITS[metric] || "";
      const valFmt = metric === "prompts" ? Math.round(val) : val.toFixed(2);
      const title = item.fullDate || item.label;

      tooltip.innerHTML = `
        <div class="tooltip-title">${title}</div>
        <div class="tooltip-value">${valFmt} ${unit}</div>
      `;

      tooltip.style.opacity = "1";
      const rect = bar.getBoundingClientRect();
      const parentRect = container.getBoundingClientRect();

      const left = rect.left - parentRect.left + rect.width / 2;
      const top  = rect.top - parentRect.top - 8;

      tooltip.style.transform = `translate(-50%, -100%)`;
      tooltip.style.left = `${left}px`;
      tooltip.style.top  = `${top}px`;
    });

    bar.addEventListener("mouseleave", () => {
      if (tooltip) tooltip.style.opacity = "0";
    });
  });
}

// ── Analytics KPI Rendering ────────────────────────────────────────
function renderAnalytics(data) {
  const totalReqs = (data.text_count ?? 0) + (data.thinking_count ?? 0) + (data.image_count ?? 0);
  const hasData = totalReqs > 0;

  const emptyEl = document.getElementById("dash-empty");
  const heroEl  = document.querySelector(".hero-card");
  const chartEl = document.querySelector(".chart-section");
  const gridEl  = document.querySelector(".kpi-grid");

  if (emptyEl) emptyEl.hidden = hasData;
  if (heroEl) heroEl.style.display = hasData ? "flex" : "none";
  if (chartEl) chartEl.style.display = hasData ? "flex" : "none";
  if (gridEl) gridEl.style.display = hasData ? "grid" : "none";

  if (!hasData) return;

  // Prompts Hero Card
  setText("kpi-prompts", String(totalReqs));
  setText("equiv-prompts", totalReqs === 1 
    ? "1 request submitted across monitored AI platforms." 
    : `${totalReqs} total prompts aggregated across models.`);

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
  setText("equiv-cost", data.cost_eur > 0.001 
    ? `≈ Industry standard token computation rate (${PROVIDER_NAMES[currentPlatform] || "Multi-cloud"})` 
    : "< 0.001 € estimated cost");

  // Gauges
  const multiplier = currentPeriod === "year" ? 365 : currentPeriod === "month" ? 30 : currentPeriod === "week" ? 7 : 1;
  setGauge("gf-co2",    Math.min(100, (data.co2_g    / (5 * multiplier))    * 100));
  setGauge("gf-water",  Math.min(100, (data.water_ml / (1000 * multiplier)) * 100));
  setGauge("gf-energy", Math.min(100, (data.wh       / (20 * multiplier))   * 100));
  setGauge("gf-cost",   Math.min(100, (data.cost_eur / (0.5 * multiplier))  * 100));
}

function renderPeriodInfo(period, platform) {
  const now = new Date();
  let label = "";

  if (period === "day") {
    label = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } else if (period === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    const opts = { day: "numeric", month: "short" };
    label = `${start.toLocaleDateString("en-GB", opts)} – ${now.toLocaleDateString("en-GB", opts)} (7-Day Aggregate)`;
  } else if (period === "month") {
    label = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) + " (Monthly View)";
  } else if (period === "year") {
    label = `${now.getFullYear()} (Full Year Overview)`;
  }

  const platLabel = platform !== "all" ? ` • ${PROVIDER_NAMES[platform] || platform}` : " • All Providers";
  setText("period-info", label + platLabel);
}

// ── Quotas Tab Logic ───────────────────────────────────────────────
async function initQuotaControls() {
  const stored   = await chrome.storage.local.get("user_settings");
  const settings = Object.assign({}, DEFAULT_SETTINGS, stored.user_settings ?? {});

  const toggle   = document.getElementById("quota-toggle");
  const select   = document.getElementById("quota-metric");
  const range    = document.getElementById("quota-range");
  const number   = document.getElementById("quota-number");
  const controls = document.getElementById("quota-controls");

  if (!toggle || !select || !range || !number) return;

  // Restore saved state
  toggle.checked = settings.limit_enabled;
  select.value   = settings.limit_metric;
  applyMetricRange(settings.limit_metric, settings.limit_value, range, number);
  updateUnitLabel(settings.limit_metric);
  updateEquivText(settings.limit_metric, Number(settings.limit_value));
  controls.classList.toggle("disabled", !settings.limit_enabled);

  // Listeners
  toggle.addEventListener("change", () => {
    controls.classList.toggle("disabled", !toggle.checked);
    saveSettings();
  });

  select.addEventListener("change", () => {
    const metric = select.value;
    const [min, max, step, def] = METRIC_RANGES[metric];
    range.min    = min;
    range.max    = max;
    range.step   = step;
    range.value  = def;
    number.value = def;
    updateUnitLabel(metric);
    updateEquivText(metric, def);
    saveSettings();
    refreshQuotaProgress();
  });

  range.addEventListener("input", () => {
    number.value = range.value;
    updateEquivText(select.value, Number(range.value));
    saveSettings();
  });

  number.addEventListener("input", () => {
    const v = Math.max(Number(range.min), Math.min(Number(range.max), Number(number.value) || 1));
    range.value  = v;
    number.value = v;
    updateEquivText(select.value, v);
    saveSettings();
    refreshQuotaProgress();
  });

  number.addEventListener("blur", () => {
    const v = Math.max(Number(range.min), Math.min(Number(range.max), Number(number.value) || 1));
    number.value = v;
  });

  refreshQuotaProgress();
}

function applyMetricRange(metric, savedValue, range, number) {
  const [min, max, step, def] = METRIC_RANGES[metric] ?? [1, 100, 1, 15];
  range.min    = min;
  range.max    = max;
  range.step   = step;
  const value  = Math.max(min, Math.min(max, Number(savedValue) || def));
  range.value  = value;
  number.value = value;
}

function updateUnitLabel(metric) {
  const el = document.getElementById("quota-unit-label");
  if (el) el.textContent = METRIC_UNITS[metric] ?? "";
}

function updateEquivText(metric, value) {
  const el = document.getElementById("quota-equiv");
  if (!el) return;

  let equiv = "";
  if (metric === "prompts") {
    equiv = `≈ ${value} standard prompt interactions per day`;
  } else if (metric === "co2") {
    const p = (value / PROMPT_EQUIV.co2_g).toFixed(1);
    equiv = `≈ ${p} standard prompts / day (based on ~0.60 g CO₂ / query)`;
  } else if (metric === "water") {
    const p = (value / PROMPT_EQUIV.water_ml).toFixed(1);
    equiv = `≈ ${p} standard prompts / day (based on ~22 mL water / query)`;
  } else if (metric === "energy") {
    const p = (value / PROMPT_EQUIV.wh).toFixed(1);
    equiv = `≈ ${p} standard prompts / day (based on ~2.0 Wh energy / query)`;
  }

  el.textContent = equiv;
}

async function saveSettings() {
  const settings = {
    limit_enabled: document.getElementById("quota-toggle").checked,
    limit_metric:  document.getElementById("quota-metric").value,
    limit_value:   Number(document.getElementById("quota-number").value),
  };
  await chrome.storage.local.set({ user_settings: settings });
}

async function refreshQuotaProgress() {
  const todayKey = "usage_" + dateStr(new Date());
  const stored   = await chrome.storage.local.get(["user_settings", todayKey]);
  const settings = Object.assign({}, DEFAULT_SETTINGS, stored.user_settings ?? {});
  const today    = stored[todayKey] ?? {};
  const limit    = Number(settings.limit_value) || DEFAULT_SETTINGS.limit_value;
  const metric   = settings.limit_metric;

  let current = 0;
  if (metric === "prompts") {
    current = (today.text_count ?? 0) + (today.thinking_count ?? 0) + (today.image_count ?? 0);
  } else if (metric === "co2")   { current = Number(today.co2_g)    || 0; }
  else if (metric === "water")  { current = Number(today.water_ml)  || 0; }
  else if (metric === "energy") { current = Number(today.wh)        || 0; }

  const pct  = Math.min(100, (current / limit) * 100);
  const fill = document.getElementById("quota-gauge-fill");
  const text = document.getElementById("quota-progress-text");
  const unit = METRIC_UNITS[metric] ?? "";

  if (fill) {
    fill.style.width = pct.toFixed(1) + "%";
    fill.classList.toggle("over-limit", pct >= 100);
  }
  if (text) {
    const curFmt = metric === "prompts" ? current.toFixed(0) : current.toFixed(1);
    text.textContent = `${curFmt} / ${limit} ${unit} (${pct.toFixed(0)}%)`;
    text.style.color = pct >= 100 ? "#f87171" : "var(--green-neon)";
  }
}

// ── Formatters ─────────────────────────────────────────────────────
function fmtCo2(g) {
  if (!g || g === 0) return "0.0 g";
  if (g >= 1000) return (g / 1000).toFixed(2) + " kg";
  if (g >= 1) return g.toFixed(2) + " g";
  return (g * 1000).toFixed(0) + " mg";
}

function equivCo2(g) {
  if (!g || g === 0) return "0 km in a combustion car";
  if (g >= 120) return `≈ ${(g / 120).toFixed(1)} km in a gasoline vehicle`;
  if (g >= 8)   return `≈ ${Math.round(g / 8)} smartphone charges`;
  return "< 1 smartphone charge";
}

function fmtWater(ml) {
  if (!ml || ml === 0) return "0.0 mL";
  if (ml >= 1000) return (ml / 1000).toFixed(2) + " L";
  if (ml >= 1) return ml.toFixed(1) + " mL";
  return (ml * 1000).toFixed(0) + " µL";
}

function equivWater(ml) {
  if (!ml || ml === 0) return "0 cups of water";
  if (ml >= 250) return `≈ ${(ml / 250).toFixed(1)} glasses of drinking water`;
  if (ml >= 150) return `≈ ${(ml / 150).toFixed(1)} cups of hot tea`;
  return "< 1 cup of espresso";
}

function fmtEnergy(wh) {
  if (!wh || wh === 0) return "0.0 Wh";
  if (wh >= 1000) return (wh / 1000).toFixed(2) + " kWh";
  if (wh >= 1) return wh.toFixed(2) + " Wh";
  return (wh * 1000).toFixed(0) + " mWh";
}

function equivEnergy(wh) {
  if (!wh || wh === 0) return "0 min LED lighting";
  if (wh >= 10) return `≈ ${Math.round((wh / 80) * 3600)} s of 55\" 4K TV operation`;
  if (wh > 0)  return `≈ ${Math.round((wh / 0.008) * 60)} min of 10W LED bulb illumination`;
  return "< 1 min of LED bulb";
}

function fmtCost(eur) {
  if (!eur || eur === 0) return "0.00 €";
  if (eur >= 1) return eur.toFixed(2) + " €";
  if (eur >= 0.01) return eur.toFixed(4) + " €";
  if (eur >= 0.001) return (eur * 100).toFixed(3) + " c€";
  return "< 0.001 €";
}

// ── Helpers ────────────────────────────────────────────────────────
function mergeInto(target, src) {
  target.water_ml       += Number(src.water_ml)       || 0;
  target.wh             += Number(src.wh)             || 0;
  target.co2_g          += Number(src.co2_g)          || 0;
  target.cost_eur       += Number(src.cost_eur)       || 0;
  target.text_count     += Number(src.text_count)     || 0;
  target.thinking_count += Number(src.thinking_count) || 0;
  target.image_count    += Number(src.image_count)    || 0;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setGauge(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = pct.toFixed(1) + "%";
}

function setActive(btn, selector) {
  document.querySelectorAll(selector).forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
}

function dateStr(d) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}
