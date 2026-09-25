// Continuous colour scales. Every colour decision for the map lives here.
export const TEMPERATURE = {
  title: "氣溫 °C",
  unit: "°",
  min: 10,
  max: 36,
  ticks: [10, 15, 20, 25, 30, 35],
  stops: [
    [10, "#2c7bb6"], [16, "#00a6ca"], [20, "#00ccbc"], [24, "#90eb9d"],
    [27, "#ffff8c"], [30, "#f9d057"], [32, "#f29e2e"], [34, "#e76818"], [36, "#d7191c"],
  ],
};

export const POP = {
  title: "降雨機率 %",
  unit: "%",
  min: 0,
  max: 100,
  ticks: [0, 20, 40, 60, 80, 100],
  stops: [[0, "#e0f2fe"], [30, "#7dd3fc"], [60, "#3b82f6"], [100, "#1e3a8a"]],
};

export const MISSING = "#64748b";

export const scaleFor = (layer) => (layer === "pop" ? POP : TEMPERATURE);

const hex = (color) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

export function colorAt(scale, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return MISSING;
  const { stops } = scale;
  if (value <= stops[0][0]) return stops[0][1];
  if (value >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 1; i < stops.length; i += 1) {
    const [v1, c1] = stops[i];
    if (value <= v1) {
      const [v0, c0] = stops[i - 1];
      const t = (value - v0) / (v1 - v0);
      const a = hex(c0);
      const b = hex(c1);
      return toHex(a.map((x, j) => x + (b[j] - x) * t));
    }
  }
  return MISSING;
}

export function renderLegend(element, scale) {
  const span = scale.max - scale.min;
  const gradient = scale.stops.map(([v, c]) => `${c} ${((v - scale.min) / span) * 100}%`).join(", ");
  element.innerHTML = `
    <span class="legend-title">${scale.title}</span>
    <span class="legend-scale">
      <span class="legend-bar" style="background: linear-gradient(90deg, ${gradient})"></span>
      <span class="legend-ticks">${scale.ticks.map((t) => `<span>${t}</span>`).join("")}</span>
    </span>`;
}

// Stepped scales: each band's upper bound and colour.
// MOENV's six AQI categories, with the ink that reads on each.
export const AQI = {
  title: "空氣品質 AQI",
  bands: [
    [50, "#00e400", "良好", "#0b1220"],
    [100, "#ffff00", "普通", "#0b1220"],
    [150, "#ff7e00", "對敏感族群不健康", "#0b1220"],
    [200, "#ff0000", "對所有族群不健康", "#ffffff"],
    [300, "#8f3f97", "非常不健康", "#ffffff"],
    [Infinity, "#7e0023", "危害", "#ffffff"],
  ],
  ticks: [0, 51, 101, 151, 201, 301],
};

// Wind in m/s: calm is a pale, faint line, 6 級 (10.8) turns yellow and
// 8 級 (17.2) red. wind.js fades the calm bands so the strong wind leads.
export const WIND = {
  title: "地面風速 m/s",
  bands: [
    [2, "#e2e8f0"],
    [4, "#bae6fd"],
    [6, "#7dd3fc"],
    [8, "#5eead4"],
    [10.8, "#a3e635"],
    [13.9, "#facc15"],
    [17.2, "#fb923c"],
    [Infinity, "#f87171"],
  ],
  ticks: [0, 2, 4, 6, 8, 10.8, 13.9, 17.2],
};

/** The band a value falls in: [upper, colour, …]. */
export const bandOf = (scale, value) => scale.bands.find(([upper]) => value <= upper) ?? scale.bands.at(-1);

/** A stepped scale's key: equal cells, each labelled at its lower bound. */
export function renderBands(element, scale) {
  const n = scale.bands.length;
  const gradient = scale.bands.map(([, c], i) => `${c} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`).join(", ");
  element.innerHTML = `
    <span class="legend-title">${scale.title}</span>
    <span class="legend-scale">
      <span class="legend-bar" style="background: linear-gradient(90deg, ${gradient})"></span>
      <span class="legend-ticks stepped" style="grid-template-columns: repeat(${n}, 1fr)">${scale.ticks.map((t) => `<span>${t}</span>`).join("")}</span>
    </span>`;
}
