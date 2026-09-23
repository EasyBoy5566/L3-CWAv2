// Map layers drawn on the globe, each one a Cesium data source built from
// /api/overlays/<name> when its switch is turned on. Station and township
// datasets are not drawn as points any more: they feed the township card
// (town-data.js). The typhoon is the one dataset that belongs on the map.
/* global Cesium */
import { getJSON } from "./api.js";
import { escapeHtml, hhmm } from "./format.js";

const color = (css, alpha = 1) => Cesium.Color.fromCssColorString(css).withAlpha(alpha);
const num = (value, digits = 1, unit = "") => (value === null || value === undefined ? "—" : `${Number(value).toFixed(digits)}${unit}`);

// Layer definitions: what each draws, and what its hover card says.
const DEFINITIONS = {
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
    return DEFINITIONS[name].info(properties.row.getValue());
  }
}
