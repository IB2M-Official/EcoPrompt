/**
 * constants.js  –  EcoPrompt v1.5.0
 *
 * Base de donnees environnementale calibree par requete moyenne (~400-500 tokens).
 * Valeurs de reference :
 *   light     : ~0,3 Wh  | ~4 mL eau totale   | ~0,08 g CO2 | ~0,0003 EUR
 *   standard  : ~2,0 Wh  | ~22 mL eau totale  | ~0,60 g CO2 | ~0,003  EUR
 *   reasoning : ~8,5 Wh  | ~120 mL eau totale | ~2,50 g CO2 | ~0,025  EUR
 *   image     : ~30,0 Wh | ~300 mL eau totale | ~9,00 g CO2 | ~0,04   EUR
 */

// ─── Donnees par fournisseur & tier ─────────────────────────────────────────

export const AI_MODELS = {
  openai: {
    name: "ChatGPT",
    domains: ["chatgpt.com", "chat.openai.com"],
    tiers: {
      light: {
        label: "GPT-4o mini",
        wh: 0.3, water_ml: 4, co2_g: 0.08, cost_eur: 0.0003,
      },
      standard: {
        label: "GPT-4o",
        wh: 2.0, water_ml: 22, co2_g: 0.60, cost_eur: 0.003,
      },
      reasoning: {
        label: "o1 / o3 / o4 (Raisonnement)",
        wh: 8.5, water_ml: 120, co2_g: 2.50, cost_eur: 0.025,
      },
      image: {
        label: "DALL-E 3",
        wh: 30.0, water_ml: 300, co2_g: 9.00, cost_eur: 0.04,
      },
    },
  },

  google: {
    name: "Gemini",
    domains: ["gemini.google.com"],
    tiers: {
      light: {
        label: "Gemini Flash",
        wh: 0.3, water_ml: 4, co2_g: 0.08, cost_eur: 0.0003,
      },
      standard: {
        label: "Gemini Pro",
        wh: 2.0, water_ml: 22, co2_g: 0.60, cost_eur: 0.003,
      },
      reasoning: {
        label: "Gemini Deep Think",
        wh: 8.5, water_ml: 120, co2_g: 2.50, cost_eur: 0.025,
      },
      image: {
        label: "Imagen 3",
        wh: 30.0, water_ml: 300, co2_g: 9.00, cost_eur: 0.04,
      },
    },
  },

  anthropic: {
    name: "Claude",
    domains: ["claude.ai"],
    tiers: {
      light: {
        label: "Claude Haiku",
        wh: 0.3, water_ml: 4, co2_g: 0.08, cost_eur: 0.0003,
      },
      standard: {
        label: "Claude Sonnet",
        wh: 2.0, water_ml: 22, co2_g: 0.60, cost_eur: 0.003,
      },
      reasoning: {
        label: "Claude Opus / Extended Thinking",
        wh: 8.5, water_ml: 120, co2_g: 2.50, cost_eur: 0.025,
      },
    },
  },
};

// ─── Coefficients de ponderation par longueur de prompt ─────────────────────

/** Seuils et multiplicateurs appliques sur wh et co2_g. */
export const LENGTH_MULTIPLIERS = [
  { minChars: 3000, factor: 1.8 },
  { minChars: 1000, factor: 1.3 },
  { minChars: 0,    factor: 1.0 },
];

/**
 * Calcule le facteur multiplicateur selon la longueur du prompt.
 * @param {number} charCount
 * @returns {number}
 */
export function getLengthFactor(charCount) {
  for (const { minChars, factor } of LENGTH_MULTIPLIERS) {
    if (charCount >= minChars) return factor;
  }
  return 1.0;
}

// ─── Equivalences perceptibles ────────────────────────────────────────────

export const EQUIVALENCES = {
  /**
   * CO2 : distance en voiture thermique (120 g/km) ou recharges smartphone (8 g/charge).
   * @param {number} grams
   * @returns {string}
   */
  co2(grams) {
    if (grams >= 1000) {
      return `${(grams / 1000).toFixed(2)} kg CO\u2082`;
    }
    if (grams >= 120) {
      const km = (grams / 120).toFixed(1);
      return `${grams.toFixed(1)} g CO\u2082 (\u2248 ${km} km en voiture)`;
    }
    if (grams >= 8) {
      const charges = Math.round(grams / 8);
      return `${grams.toFixed(2)} g CO\u2082 (\u2248 ${charges} charge${charges > 1 ? "s" : ""} smartphone)`;
    }
    return `${grams.toFixed(2)} g CO\u2082`;
  },

  /**
   * Eau : gouttes, mL, verres (250 mL) ou litres.
   * @param {number} ml
   * @returns {string}
   */
  water(ml) {
    if (ml < 1) return `${(ml * 1000).toFixed(0)} \u00b5L`;
    if (ml < 150) return `${ml.toFixed(1)} mL`;
    if (ml < 250) {
      const cups = (ml / 150).toFixed(1);
      return `${ml.toFixed(0)} mL (\u2248 ${cups} tasse${parseFloat(cups) > 1 ? "s" : ""} de th\u00e9)`;
    }
    const glasses = Math.round(ml / 250);
    if (ml < 1000) {
      return `${ml.toFixed(0)} mL (\u2248 ${glasses} verre${glasses > 1 ? "s" : ""})`;
    }
    return `${(ml / 1000).toFixed(2)} L (\u2248 ${glasses} verres)`;
  },

  /**
   * Energie : Wh, minutes d ampoule LED 8W ou secondes de TV 80W.
   * @param {number} wh
   * @returns {string}
   */
  energy(wh) {
    if (wh < 1) {
      const mwh = (wh * 1000).toFixed(0);
      return `${mwh} mWh`;
    }
    if (wh < 10) {
      const ledMins = Math.round((wh / 0.008) * 60); // LED 8W
      return `${wh.toFixed(2)} Wh (\u2248 ${ledMins} min ampoule LED)`;
    }
    const tvSecs = Math.round((wh / 80) * 3600); // TV 80W
    return `${wh.toFixed(1)} Wh (\u2248 ${tvSecs} s de TV)`;
  },

  /**
   * Cout en euros.
   * @param {number} eur
   * @returns {string}
   */
  cost(eur) {
    if (eur < 0.001) return `< 0,001 \u20ac`;
    if (eur < 0.01)  return `${(eur * 100).toFixed(3)} c\u20ac`;
    return `${eur.toFixed(4)} \u20ac`;
  },
};

// ─── Donation URL ─────────────────────────────────────────────────────────────

export const DONATION_URL = "https://ko-fi.com/ib2m_official";

// ─────────────────────────────────────────────────────────────────────────────
// v1.2.0 — Daily quota system & educational content
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default user settings stored under chrome.storage.local key "user_settings".
 * Retrocompatibility: these defaults are applied only when the key is absent.
 *
 * Conversion reference (1 standard prompt):
 *   ~2 Wh  |  ~22 mL water  |  ~0.60 g CO2
 */
export const DEFAULT_SETTINGS = {
  limit_enabled: true,
  limit_metric:  "prompts",   // "prompts" | "co2" | "water" | "energy"
  limit_value:   15,          // 15 prompts | 10 g CO2 | 500 mL water | 30 Wh
};

/**
 * Conversion constants: 1 standard prompt equivalent.
 * Used to display "≈ X standard prompts / day" when a non-prompt metric is chosen.
 */
export const PROMPT_EQUIV = {
  wh:       2.0,   // Wh per standard prompt
  water_ml: 22,    // mL per standard prompt
  co2_g:    0.60,  // g CO2 per standard prompt
};

/**
 * Milestone & quota-breach alert messages.
 * Displayed as toasts in content.js when a trigger is crossed.
 */
export const MILESTONE_MESSAGES = [
  {
    trigger: "prompts_10",
    text: "⚡ 10 prompts reached today! Your AI requests are starting to add up.",
  },
  {
    trigger: "water_500",
    text: "🚰 Splash! You have already used the equivalent of 2 large water bottles today.",
  },
  {
    trigger: "co2_20",
    text: "🚗 Today's prompts already equal more than 150 m driven in a combustion car.",
  },
  {
    trigger: "limit_reached",
    text: "🚨 Daily quota reached! Consider batching your next requests.",
  },
];

/**
 * Educational content for the Guide tab.
 * Each article has: id, emoji, title, and an array of paragraphs / bullet points.
 */
export const INFO_ARTICLES = [
  {
    id:    "about",
    emoji: "🌱",
    title: "About EcoPrompt",
    paragraphs: [
      "EcoPrompt was built to bring ecological transparency to AI usage — without guilt-tripping anyone. Our goal is simply to make the invisible visible.",
      "Every figure shown is calculated locally in your browser. No data ever leaves your device. No account, no server, no tracking.",
      "Estimates are based on peer-reviewed research and publicly available energy data from major AI providers (2023–2025).",
      "Mission: help users make informed choices — switch to a lighter model, batch requests, or simply be aware of the real cost of convenience.",
    ],
  },
  {
    id:    "why",
    emoji: "⚡",
    title: "Why does AI consume so much?",
    paragraphs: [
      "Every prompt triggers thousands of matrix multiplications across millions of GPU/TPU cores running at full power.",
      "Data centers hosting these models draw enormous amounts of electricity — and generate heat that must be dissipated using water-cooled systems (cooling towers evaporate hundreds of liters per hour).",
      "A single 'reasoning' or 'thinking' query (o3, Claude Opus, Gemini Deep Think) can consume 4–10× more energy than a standard text prompt, because the model iterates internally before answering.",
      "Generating an image is even more intensive: roughly 15× a standard text prompt, due to the iterative diffusion process across hundreds of denoising steps.",
    ],
  },
  {
    id:    "tips",
    emoji: "💡",
    title: "5 eco-habits for AI",
    tips: [
      {
        badge: "Model",
        color: "green",
        text:  "Use a lightweight model (Flash, Haiku, GPT-4o mini) for simple tasks like summarising, reformatting or translating.",
      },
      {
        badge: "Thinking",
        color: "violet",
        text:  "Reserve reasoning mode (o3, Extended Thinking, Deep Think) for genuinely complex logical problems.",
      },
      {
        badge: "Prompt",
        color: "cyan",
        text:  "Write precise, complete prompts on the first try to avoid back-and-forth iterations.",
      },
      {
        badge: "Media",
        color: "amber",
        text:  "Prefer plain text over image generation whenever possible — one generated image ≈ 15 standard prompts.",
      },
      {
        badge: "Context",
        color: "slate",
        text:  "Start a new conversation rather than letting context grow very long; large contexts increase compute per token.",
      },
    ],
  },
];
