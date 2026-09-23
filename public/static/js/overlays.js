// Optional data layers on the globe, each one a Cesium data source built
// from /api/overlays/<name> when its switch is turned on.
/* global Cesium */
import { getJSON } from "./api.js";
import { escapeHtml, hhmm, windText } from "./format.js";
import { TEMPERATURE, colorAt } from "./scale.js";

const RAIN = {
  unit: " mm",
  stops: [[0.5, "#a5f3fc"], [2, "#38bdf8"], [5, "#2563eb"], [10, "#22c55e"], [20, "#eab308"], [40, "#f97316"], [80, "#ef4444"], [150, "#c026d3"], [300, "#7e22ce"]],
};
const HEAT = { stops: [[20, "#4ade80"], [26, "#facc15"], [30, "#fb923c"], [34, "#ef4444"], [38, "#a21caf"]] };
const UV = { stops: [[0, "#4ade80"], [3, "#facc15"], [6, "#fb923c"], [8, "#ef4444"], [11, "#a855f7"]] };

const color = (css, alpha = 1) => Cesium.Color.fromCssColorString(css).withAlpha(alpha);
const stepColor = (scale, value) => {
  let found = scale.stops[0][1];
  for (const [limit, hex] of scale.stops) if (value >= limit) found = hex;
  return found;
};
const num = (value, digits = 1, unit = "") => (value === null || value === undefined ? "—" : `${Number(value).toFixed(digits)}${unit}`);
const clamp = { heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY };
const place = (row) => Cesium.Cartesian3.fromDegrees(row.lon, row.lat);

// Layer definitions: what each draws, and what its hover card says.
const DEFINITIONS = {
  rain: {
    build(source, data) {
      let wet = 0;
      for (const s of data.stations) {
        const r24 = s.r24h ?? 0;
        if (r24 > 0) {
          wet += 1;
          // A column per wet gauge: height by the day's total, colour by intensity.
          const length = Math.min(Math.max(r24 * 220, 900), 45000);
          source.entities.add({
            position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, length / 2),
            cylinder: {
              length,
              topRadius: 700,
              bottomRadius: 700,
              material: color(stepColor(RAIN, r24), 0.85),
              heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            },
            properties: { overlay: "rain", row: s },
          });
        } else {
          source.entities.add({
            position: place(s),
            point: { pixelSize: 2.5, color: color("#cbd5e1", 0.28), ...clamp },
            properties: { overlay: "rain", row: s },
          });
        }
      }
      return `${wet} 站 24 小時內有雨`;
    },
    info: (s) => ({
      title: s.name,
      sub: `${s.county ?? ""}${s.town ?? ""} · ${hhmm(s.time)}`,
      lines: [["10 分鐘", num(s.r10m, 1, " mm")], ["1 小時", num(s.r1h, 1, " mm")], ["3 小時", num(s.r3h, 1, " mm")], ["24 小時", num(s.r24h, 1, " mm")], ["3 天", num(s.r3d, 1, " mm")]],
    }),
    legend: { title: "24 小時雨量 mm", stops: RAIN.stops },
  },

  stations: {
    build(source, data) {
      for (const s of data.stations) {
        source.entities.add({
          position: place(s),
          point: { pixelSize: 7, color: color(colorAt(TEMPERATURE, s.t)), outlineColor: color("#ffffff", 0.7), outlineWidth: 1, ...clamp },
          properties: { overlay: "stations", row: s },
        });
      }
      return `${data.stations.length} 站 · ${hhmm(data.time)} 觀測`;
    },
    info: (s) => ({
      title: s.name,
      sub: `${s.county ?? ""}${s.town ?? ""} · 海拔 ${num(s.alt, 0, " m")} · ${hhmm(s.time)}`,
      lines: [["氣溫", num(s.t, 1, "°C")], ["今日高／低", `${num(s.hi, 1, "°")} / ${num(s.lo, 1, "°")}`], ["濕度", num(s.rh, 0, "%")], ["氣壓", num(s.p, 1, " hPa")],
        ["風", `${num(s.ws, 1, " m/s")} ${windText(s.wd)}`], ["陣風", num(s.gust, 1, " m/s")], ["天氣", escapeHtml(s.wx ?? "—")]],
    }),
  },

  typhoon: {
    animated: true,
    build(source, data) {
      if (!data.cyclones.length) return "目前沒有活動中的颱風";
      for (const cyclone of data.cyclones) buildCyclone(source, cyclone);
      return data.cyclones.map((c) => c.name).join("、");
    },
    info: (row) => row,
    fly: true,
  },

  heat: {
    build(source, data) {
      for (const t of data.towns) {
        const hue = t.warning ? "#ef4444" : stepColor(HEAT, t.index ?? 0);
        source.entities.add({
          position: place(t),
          point: { pixelSize: 8, color: color(hue, 0.9), outlineColor: color("#ffffff", 0.5), outlineWidth: 1, ...clamp },
          properties: { overlay: "heat", row: t },
        });
      }
      const warned = data.towns.filter((t) => t.warning).length;
      return warned ? `${warned} 個鄉鎮有警示` : `${data.towns.length} 鄉鎮 · 無警示`;
    },
    info: (t) => ({
      title: `${t.county ?? ""}${t.town ?? ""}`,
      sub: `熱傷害指數 · ${hhmm(t.time)}`,
      lines: [["指數", num(t.index, 0)], ["警示", escapeHtml(t.warning || "無")], ["24 小時內最高", t.peak === null ? "—" : `${num(t.peak, 0)}（${hhmm(t.peakTime)}）`]],
    }),
    legend: { title: "熱傷害指數", stops: HEAT.stops },
  },

  uv: {
    build(source, data) {
      for (const s of data.stations) {
        source.entities.add({
          position: place(s),
          point: { pixelSize: 13, color: color(stepColor(UV, s.uv), 0.95), outlineColor: color("#ffffff", 0.8), outlineWidth: 1.5, ...clamp },
          label: {
            text: `UV ${Math.round(s.uv)}`, font: "600 12px 'Noto Sans TC', sans-serif", fillColor: Cesium.Color.WHITE,
            outlineColor: color("#0b1220"), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -16), ...clamp,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 900000),
          },
          properties: { overlay: "uv", row: s },
        });
      }
      return `${data.stations.length} 站 · ${data.date ?? ""} 最大值`;
    },
    info: (s) => ({ title: s.name, sub: `${s.county ?? ""} · 當日最大值`, lines: [["紫外線指數", num(s.uv, 0)]] }),
    legend: { title: "紫外線指數", stops: UV.stops },
  },

  townships: {
    build(source, data) {
      for (const t of data.towns) {
        source.entities.add({
          position: place(t),
          point: { pixelSize: 6, color: color(colorAt(TEMPERATURE, t.t)), outlineColor: color("#0b1220", 0.6), outlineWidth: 1, ...clamp },
          label: {
            text: t.t === null ? "" : `${Math.round(t.t)}°`, font: "600 11px 'Noto Sans TC', sans-serif", fillColor: Cesium.Color.WHITE,
            outlineColor: color("#0b1220"), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -12), ...clamp,
            // Labels only once the camera is close enough to read 368 of them.
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 180000),
          },
          properties: { overlay: "townships", row: t },
        });
      }
      return `${data.towns.length} 鄉鎮 · 逐時預報`;
    },
    info: (t) => ({
      title: `${t.county ?? ""}${t.town ?? ""}`,
      sub: "鄉鎮預報",
      lines: [["氣溫", num(t.t, 0, "°C")], ["天氣", escapeHtml(t.wx ?? "—")], ["降雨機率", num(t.pop, 0, "%")]],
    }),
  },
};

// ---------- typhoon ----------

// A spiral cloud band, drawn once, used as the texture of a rotating disc.
let spiral = null;
function spiralImage() {
  if (spiral) return spiral;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  const c = size / 2;
  const glow = context.createRadialGradient(c, c, 4, c, c, c);
  glow.addColorStop(0, "rgba(255,255,255,0)");
  glow.addColorStop(0.12, "rgba(255,255,255,0.85)");
  glow.addColorStop(0.5, "rgba(226,232,240,0.35)");
  glow.addColorStop(1, "rgba(226,232,240,0)");
  for (let arm = 0; arm < 4; arm += 1) {
    context.beginPath();
    for (let t = 0; t <= 1; t += 0.01) {
      const angle = arm * (Math.PI / 2) + t * Math.PI * 2.2;
      const radius = 10 + t * (c - 12);
      const x = c + radius * Math.cos(angle);
      const y = c + radius * Math.sin(angle);
      if (t === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.lineWidth = 22;
    context.strokeStyle = glow;
    context.lineCap = "round";
    context.stroke();
  }
  context.globalCompositeOperation = "destination-out";
  context.beginPath();
  context.arc(c, c, 7, 0, Math.PI * 2);
  context.fill(); // the eye
  spiral = canvas;
  return spiral;
}

// Points on a circle of `km` around a lon/lat, for the probability cone.
function circle(lon, lat, km, steps = 36) {
  const points = [];
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    points.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return points;
}

// Convex hull (monotone chain) of the circles: the cone of the forecast track.
function hull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function buildCyclone(source, cyclone) {
  const now = cyclone.track.at(-1);
  const info = {
    title: `${cyclone.name ?? ""}${cyclone.nameEn ? ` ${cyclone.nameEn}` : ""}`,
    sub: `颱風 · ${hhmm(now.time)} 定位`,
    lines: [["中心氣壓", num(now.pressure, 0, " hPa")], ["最大風速", num(now.wind, 0, " m/s")], ["瞬間陣風", num(now.gust, 0, " m/s")],
      ["七級風暴風半徑", num(now.r15, 0, " km")], ["動向", escapeHtml(now.moving ?? "—")]],
  };

  // The cone: the hull of each forecast point's 70% probability circle.
  const conePoints = [[now.lon, now.lat]];
  for (const f of cyclone.forecast) conePoints.push(...circle(f.lon, f.lat, f.r70 ?? 0));
  if (cyclone.forecast.length) {
    source.entities.add({
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(hull(conePoints).flat()),
        material: color("#e2e8f0", 0.14),
        outline: true,
        outlineColor: color("#e2e8f0", 0.5),
        height: 0,
      },
      properties: { overlay: "typhoon", row: info },
    });
  }
  // Past track, glowing; forecast track, dashed.
  source.entities.add({
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(cyclone.track.flatMap((p) => [p.lon, p.lat])),
      width: 5,
      material: new Cesium.PolylineGlowMaterialProperty({ color: color("#f9a8d4"), glowPower: 0.25 }),
    },
  });
  if (cyclone.forecast.length) {
    source.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray([now, ...cyclone.forecast].flatMap((p) => [p.lon, p.lat])),
        width: 2.5,
        material: new Cesium.PolylineDashMaterialProperty({ color: color("#fbcfe8", 0.95), dashLength: 14 }),
      },
    });
  }
  for (const f of cyclone.forecast) {
    source.entities.add({
      position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat),
      point: { pixelSize: 6, color: color("#fbcfe8"), outlineColor: color("#831843"), outlineWidth: 1 },
      label: {
        text: `+${f.hour}h`, font: "600 11px 'Noto Sans TC', sans-serif", fillColor: Cesium.Color.WHITE,
        outlineColor: color("#0b1220"), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(10, 0), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      },
      properties: {
        overlay: "typhoon",
        row: { title: `${cyclone.name} 預報 +${f.hour} 小時`, sub: hhmm(f.time), lines: [["中心氣壓", num(f.pressure, 0, " hPa")], ["最大風速", num(f.wind, 0, " m/s")], ["70% 機率半徑", num(f.r70, 0, " km")]] },
      },
    });
  }
  // The gale radius on the sea, and a rotating cloud spiral floating above it.
  if (now.r15) {
    source.entities.add({
      position: Cesium.Cartesian3.fromDegrees(now.lon, now.lat),
      ellipse: {
        semiMajorAxis: now.r15 * 1000, semiMinorAxis: now.r15 * 1000, height: 0,
        material: color("#f87171", 0.12), outline: true, outlineColor: color("#f87171", 0.7),
      },
      properties: { overlay: "typhoon", row: info },
    });
  }
  const radius = Math.max(now.r15 ?? 0, 180) * 1200;
  const started = performance.now();
  source.entities.add({
    position: Cesium.Cartesian3.fromDegrees(now.lon, now.lat),
    ellipse: {
      semiMajorAxis: radius, semiMinorAxis: radius, height: 12000,
      material: new Cesium.ImageMaterialProperty({ image: spiralImage(), transparent: true }),
      // Cyclones in the northern hemisphere turn anticlockwise.
      stRotation: new Cesium.CallbackProperty(() => ((performance.now() - started) / 1000) * 0.6, false),
    },
    properties: { overlay: "typhoon", row: info },
  });
  source.entities.add({
    position: Cesium.Cartesian3.fromDegrees(now.lon, now.lat, 12000),
    label: {
      text: `${cyclone.name}\n${num(now.pressure, 0, " hPa")} · ${num(now.wind, 0, " m/s")}`,
      font: "600 13px 'Noto Sans TC', sans-serif", fillColor: Cesium.Color.WHITE, showBackground: true,
      backgroundColor: color("#0b1220", 0.55), backgroundPadding: new Cesium.Cartesian2(10, 6),
      pixelOffset: new Cesium.Cartesian2(0, -48), disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    properties: { overlay: "typhoon", row: info },
  });
}

// ---------- manager ----------

export class Overlays {
  constructor(viewer) {
    this.viewer = viewer;
    this.active = new Map(); // name → { source, status }
    this.pending = new Map();
  }

  isOn(name) {
    return this.active.has(name);
  }

  /** Turn a layer on (fetching it) or off. Resolves to a short status line. */
  async set(name, on) {
    const definition = DEFINITIONS[name];
    if (!definition) throw new Error(`unknown overlay ${name}`);
    if (!on) {
      this.pending.delete(name);
      const layer = this.active.get(name);
      if (layer) this.viewer.dataSources.remove(layer.source, true);
      this.active.delete(name);
      this.updateAnimation();
      this.viewer.scene.requestRender();
      return "";
    }
    const token = Symbol(name);
    this.pending.set(name, token);
    const data = await getJSON(`/api/overlays/${name}`);
    if (this.pending.get(name) !== token) return ""; // switched off while loading
    const source = new Cesium.CustomDataSource(name);
    const status = definition.build(source, data);
    const previous = this.active.get(name);
    await this.viewer.dataSources.add(source);
    if (previous) this.viewer.dataSources.remove(previous.source, true);
    this.active.set(name, { source, status });
    this.updateAnimation();
    if (definition.fly && !previous && source.entities.values.length) {
      this.viewer.flyTo(source, { duration: 1.8, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), 0) });
    }
    this.viewer.scene.requestRender();
    return status;
  }

  /** Re-fetch every active layer, keeping each on screen until its replacement is ready. */
  async refresh() {
    const statuses = {};
    for (const name of [...this.active.keys()]) {
      try {
        statuses[name] = await this.set(name, true);
      } catch {
        // Keep the old layer; the next poll retries.
      }
    }
    return statuses;
  }

  // The typhoon spiral turns only if the scene renders continuously.
  updateAnimation() {
    const animated = [...this.active.keys()].some((name) => DEFINITIONS[name].animated);
    this.viewer.scene.requestRenderMode = !animated;
  }

  /** The hover card for a picked overlay entity, or null. */
  infoFor(picked) {
    const properties = picked?.id?.properties;
    const name = properties?.overlay?.getValue?.();
    if (!name || !DEFINITIONS[name]) return null;
    const row = properties.row.getValue();
    return { ...DEFINITIONS[name].info(row), county: row.county ?? null };
  }

  legend(name) {
    return DEFINITIONS[name]?.legend ?? null;
  }
}
