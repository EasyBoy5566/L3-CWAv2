const TZ = "Asia/Taipei";

const timeFormat = new Intl.DateTimeFormat("zh-TW", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayFormat = new Intl.DateTimeFormat("zh-TW", { timeZone: TZ, month: "numeric", day: "numeric" });
const weekdayFormat = new Intl.DateTimeFormat("zh-TW", { timeZone: TZ, weekday: "short" });

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

export const hhmm = (iso) => (iso ? timeFormat.format(new Date(iso)) : "—");

// "9/24（四）" for a YYYY-MM-DD Taipei date.
export function dayLabel(ymd) {
  const noon = new Date(`${ymd}T12:00:00+08:00`);
  return `${dayFormat.format(noon)}（${weekdayFormat.format(noon).replace("週", "")}）`;
}

export function todayInTaipei(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}

export function num(value, digits = 0, unit = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Number(value).toFixed(digits)}${unit}`;
}

export function ago(iso, now = Date.now()) {
  if (!iso) return "無資料";
  const minutes = Math.round((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小時前`;
  return `${Math.floor(hours / 24)} 天前`;
}

const DIRECTIONS = ["北", "北北東", "東北", "東北東", "東", "東南東", "東南", "南南東", "南", "南南西", "西南", "西南西", "西", "西北西", "西北", "北北西"];

// Wind direction is where the wind comes from, as CWA reports it.
export function windText(degrees) {
  if (degrees === null || degrees === undefined) return "";
  return `${DIRECTIONS[Math.round(degrees / 22.5) % 16]}風`;
}

// CWA WeatherCode (天氣現象代碼) → a glyph.
export function wxIcon(code) {
  const c = Number(code);
  if (!c) return "";
  if (c === 1) return "☀️";
  if (c <= 3) return "🌤️";
  if (c <= 5) return "⛅";
  if (c <= 7) return "☁️";
  if ((c >= 15 && c <= 18) || (c >= 33 && c <= 36) || c === 41) return "⛈️";
  if (c === 23 || c === 37 || c === 42) return "🌨️";
  if (c >= 24 && c <= 28) return "🌫️";
  return "🌧️";
}

// Moon age and phase from the mean synodic month, referenced to the new
// moon of 2000-01-06 18:14 UTC. Good to within about a day, which is enough
// to name the phase; rise and set times come from CWA.
const SYNODIC = 29.530588853;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const PHASES = ["新月", "眉月", "上弦月", "盈凸月", "滿月", "虧凸月", "下弦月", "殘月"];

export function moonPhase(date = new Date()) {
  const age = ((((date.getTime() - NEW_MOON) / 86400000) % SYNODIC) + SYNODIC) % SYNODIC;
  const fraction = age / SYNODIC;
  const illumination = (1 - Math.cos(2 * Math.PI * fraction)) / 2;
  const name = PHASES[Math.round(fraction * 8) % 8];
  return { age, fraction, illumination, name };
}

// The lit part of the moon as seen from the northern hemisphere: waxing on the right.
export function moonSvg({ fraction, illumination }, size = 36) {
  const r = size / 2 - 1;
  const c = size / 2;
  const waxing = fraction < 0.5;
  // The terminator is a half-ellipse whose x-radius shrinks to zero at the quarters.
  const rx = Math.abs(1 - 2 * illumination) * r;
  const litSweep = waxing ? 1 : 0;
  const bulgesOut = illumination > 0.5;
  const terminatorSweep = waxing === bulgesOut ? 1 : 0;
  const path = `M ${c} ${c - r} A ${r} ${r} 0 0 ${litSweep} ${c} ${c + r} A ${rx} ${r} 0 0 ${terminatorSweep} ${c} ${c - r} Z`;
  return `<svg class="moon-disc" viewBox="0 0 ${size} ${size}" role="img" aria-label="月相示意"><circle cx="${c}" cy="${c}" r="${r}" fill="#1e293b" stroke="#475569"/><path d="${path}" fill="#e2e8f0"/></svg>`;
}
