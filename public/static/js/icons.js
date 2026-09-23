// Weather glyphs as inline SVG, so they look the same on every platform.
// Each icon is drawn on a 32×32 grid.

const SUN = `
  <circle cx="16" cy="16" r="6.2" fill="url(#g-sun)"/>
  <g stroke="#fbbf24" stroke-width="2" stroke-linecap="round">
    <path d="M16 3.5v3M16 25.5v3M3.5 16h3M25.5 16h3M7.2 7.2l2.1 2.1M22.7 22.7l2.1 2.1M7.2 24.8l2.1-2.1M22.7 9.3l2.1-2.1"/>
  </g>`;
const MOON = `<path d="M20.5 5.5a10.5 10.5 0 1 0 6 16.9A9 9 0 0 1 20.5 5.5z" fill="url(#g-moon)"/>`;
const CLOUD = (dx = 0, dy = 0, fill = "url(#g-cloud)") =>
  `<path transform="translate(${dx} ${dy})" d="M9.5 26h14a5.5 5.5 0 0 0 .6-10.97A7.5 7.5 0 0 0 9.8 13.6 6.2 6.2 0 0 0 9.5 26z" fill="${fill}"/>`;
const SMALL_SUN = `<g transform="translate(-4 -5) scale(.72)">${SUN}</g>`;
const SMALL_MOON = `<g transform="translate(-3 -4) scale(.7)">${MOON}</g>`;
const DROPS = `<g stroke="#60a5fa" stroke-width="2" stroke-linecap="round"><path d="M11 25.5l-1.5 3.5M16.5 25.5L15 29M22 25.5l-1.5 3.5"/></g>`;
const BOLT = `<path d="M17.5 22l-4 5.5h3.2l-1.7 4 5-6.2h-3.2l1.7-3.3z" fill="#facc15"/>`;
const FOG = `<g stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" opacity=".9"><path d="M6 23h20M8 27h16"/></g>`;

const DEFS = `<defs>
  <radialGradient id="g-sun" cx="40%" cy="35%"><stop offset="0" stop-color="#fef3c7"/><stop offset="1" stop-color="#f59e0b"/></radialGradient>
  <linearGradient id="g-moon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8fafc"/><stop offset="1" stop-color="#cbd5e1"/></linearGradient>
  <linearGradient id="g-cloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d7dee8"/></linearGradient>
  <linearGradient id="g-cloud-dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cbd5e1"/><stop offset="1" stop-color="#94a3b8"/></linearGradient>
</defs>`;

const SHAPES = {
  clear: (night) => (night ? MOON : SUN),
  partly: (night) => (night ? SMALL_MOON : SMALL_SUN) + CLOUD(1, 1),
  cloudy: () => CLOUD(-3, -3, "url(#g-cloud-dark)") + CLOUD(1, 0),
  rain: () => CLOUD(0, -4, "url(#g-cloud-dark)") + DROPS,
  thunder: () => CLOUD(0, -5, "url(#g-cloud-dark)") + BOLT,
  fog: () => CLOUD(0, -6) + FOG,
};

/** CWA WeatherCode (天氣現象代碼) → icon kind. */
export function kindFromCode(code) {
  const c = Number(code);
  if (!c) return null;
  if (c === 1) return "clear";
  if (c <= 3) return "partly";
  if (c <= 7) return "cloudy";
  if ((c >= 15 && c <= 18) || (c >= 33 && c <= 36) || c === 41) return "thunder";
  if (c >= 24 && c <= 28) return "fog";
  return "rain";
}

/** Station weather text (觀測「天氣」) → icon kind. */
export function kindFromText(text) {
  if (!text) return null;
  if (/雷/.test(text)) return "thunder";
  if (/雨|雪/.test(text)) return "rain";
  if (/霧|靄|霾/.test(text)) return "fog";
  if (/陰/.test(text)) return "cloudy";
  if (/雲/.test(text)) return "partly";
  if (/晴/.test(text)) return "clear";
  return null;
}

let counter = 0;

export function weatherIcon(kind, { night = false, size = 28, label = "" } = {}) {
  if (!kind || !SHAPES[kind]) return `<span class="wx-icon-empty" style="width:${size}px"></span>`;
  // Gradient ids must be unique per document; suffix them per icon.
  counter += 1;
  const suffix = `-${counter}`;
  const body = (DEFS + SHAPES[kind](night)).replace(/id="(g-[a-z-]+)"/g, `id="$1${suffix}"`).replace(/url\(#(g-[a-z-]+)\)/g, `url(#$1${suffix})`);
  return `<svg class="wx-icon" width="${size}" height="${size}" viewBox="0 0 32 32" role="img" aria-label="${label}">${body}</svg>`;
}

export const SUNRISE = `<svg class="wx-icon" width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
  <path d="M5 23h22" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/>
  <path d="M9.5 23a6.5 6.5 0 0 1 13 0" fill="#fbbf24"/>
  <path d="M16 6v6M12.5 9.5L16 6l3.5 3.5" stroke="#fbbf24" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const SUNSET = `<svg class="wx-icon" width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
  <path d="M5 23h22" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/>
  <path d="M9.5 23a6.5 6.5 0 0 1 13 0" fill="#fb923c"/>
  <path d="M16 12V6M12.5 8.5L16 12l3.5-3.5" stroke="#fb923c" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Small line glyphs for the card headers. */
export const GLYPH = {
  clock: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  calendar: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  thermo: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 2.5a1.5 1.5 0 0 1 3 0v6.8a3 3 0 1 1-3 0z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
  drop: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2s4.5 5 4.5 8a4.5 4.5 0 0 1-9 0C3.5 7 8 2 8 2z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
  wind: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h8.5a2 2 0 1 0-2-2M2 10h11a2 2 0 1 1-2 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  gauge: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 11.5a6 6 0 1 1 11 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 10l3-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  rain: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5h7.5a2.5 2.5 0 0 0 0-5 3.5 3.5 0 0 0-6.6.7A2.2 2.2 0 0 0 4 8.5z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 11l-1 2.5M8.5 11l-1 2.5M12 11l-1 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  uv: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  sun: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4.5 12a3.5 3.5 0 0 1 7 0" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 3v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  moon: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 2.5a5.5 5.5 0 1 0 3.5 9.2A4.8 4.8 0 0 1 10 2.5z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
  chart: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13h12M3 10l3-3 3 2 4-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  history: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 5v3l2 1.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
};
