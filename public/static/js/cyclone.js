// Tropical cyclone arithmetic shared by the map layer and the typhoon card:
// CWA's intensity classes, the Beaufort scale, compass names, and where a
// cyclone is (or is forecast to be) at any hour along its track.

// CWA's classes by maximum sustained wind (m/s): below 17.2 a tropical
// depression, then mild, moderate and strong typhoons.
const CLASSES = [
  { name: "熱帶性低氣壓", below: 17.2, color: "#67e8f9" },
  { name: "輕度颱風", below: 32.7, color: "#fde047" },
  { name: "中度颱風", below: 51.0, color: "#fb923c" },
  { name: "強烈颱風", below: Infinity, color: "#f43f5e" },
];

/** The classes as a key (scale.js renderBands): the track's colours, by name. */
export const CYCLONE_KEY = {
  title: "颱風強度",
  bands: CLASSES.map((c) => [c.below, c.color]),
  ticks: ["熱帶低壓", "輕度", "中度", "強烈"],
};

export function cycloneClass(wind) {
  if (wind === null || wind === undefined) return CLASSES[0];
  return CLASSES.find((c) => wind < c.below);
}

// Upper bounds of Beaufort 0–16 in m/s; 17 above. CWA reports typhoon winds this way.
const BEAUFORT = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7, 37.0, 41.5, 46.2, 51.0, 56.1];
export function beaufortLevel(speed) {
  if (speed === null || speed === undefined) return null;
  const level = BEAUFORT.findIndex((limit) => speed < limit);
  return level === -1 ? 17 : level;
}

const DIRECTIONS = {
  N: "北", NNE: "北北東", NE: "東北", ENE: "東北東", E: "東", ESE: "東南東", SE: "東南", SSE: "南南東",
  S: "南", SSW: "南南西", SW: "西南", WSW: "西南西", W: "西", WNW: "西北西", NW: "西北", NNW: "北北西",
};
export const directionName = (code) => DIRECTIONS[code] ?? code ?? "";

const HOUR = 3600 * 1000;

/** The analysed fixes then the forecast, each with `at` (ms) and `hours` from the latest fix. */
export function timeline(cyclone) {
  const now = new Date(cyclone.track.at(-1).time).getTime();
  const points = [...cyclone.track, ...cyclone.forecast].map((p) => {
    const at = new Date(p.time).getTime();
    return { ...p, at, hours: Math.round((at - now) / HOUR), forecast: at > now };
  });
  return { now, points, first: points[0].hours, last: points.at(-1).hours };
}

const lerp = (a, b, t) => (a === null || a === undefined ? b : b === null || b === undefined ? a : a + (b - a) * t);

/** Where the cyclone is at `hours` from the latest fix, interpolated between points. */
export function pointAt(line, hours) {
  const at = line.now + hours * HOUR;
  const { points } = line;
  if (at <= points[0].at) return { ...points[0], hours };
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (at > b.at) continue;
    const t = (at - a.at) / (b.at - a.at);
    return {
      lon: lerp(a.lon, b.lon, t),
      lat: lerp(a.lat, b.lat, t),
      wind: lerp(a.wind, b.wind, t),
      gust: lerp(a.gust, b.gust, t),
      pressure: lerp(a.pressure, b.pressure, t),
      r15: lerp(a.r15, b.r15, t),
      r25: t < 0.5 ? a.r25 ?? null : b.r25 ?? null,
      r70: b.forecast ? lerp(a.forecast ? a.r70 : 0, b.r70, t) : null,
      dir: t < 0.5 ? a.dir : b.dir,
      speed: t < 0.5 ? a.speed : b.speed,
      forecast: at > line.now,
      at,
      hours,
    };
  }
  return { ...points.at(-1), hours };
}
