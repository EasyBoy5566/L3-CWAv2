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
