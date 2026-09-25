// Map layers drawn on the globe, each one a Cesium data source built from
// /api/overlays/<name> when its switch is turned on. Station and township
// datasets are not layers any more: they feed the township card
// (town-data.js), and the selected township's stations are dots (globe.js).
// The typhoon is the one dataset that belongs on the map.
/* global Cesium */
import { getJSON } from "./api.js";
import { addCloudLayer, latestCloudTime } from "./clouds.js";
import { beaufortLevel, cycloneClass, directionName } from "./cyclone.js";

const color = (css, alpha = 1) => Cesium.Color.fromCssColorString(css).withAlpha(alpha);
const num = (value, digits = 1, unit = "") => (value === null || value === undefined ? "—" : `${Number(value).toFixed(digits)}${unit}`);
// "2026-09-24T14:00:00+08:00" → "9/24 14:00", in the timestamp's own (Taipei) time.
const dayTime = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} ${iso.slice(11, 16)}`;

// Layer definitions: what each draws, and what its hover card says.
const DEFINITIONS = {
  typhoon: {
    // The satellite picture's time, asked for before anything is drawn.
    prepare: async (data) => ({ cloudTime: data.cyclones.length ? await latestCloudTime() : null }),
    // Each cyclone's real cloud, full over its gale circle and fading out beyond.
    imagery: (viewer, data, { cloudTime }) => (cloudTime ? data.cyclones.map((cyclone) => {
      const now = cyclone.track.at(-1);
      const inner = Math.max((now.r15 ?? 150) * 2.4, 380);
      return addCloudLayer(viewer, cloudTime, { lon: now.lon, lat: now.lat, inner, outer: inner + 520 });
    }) : []),
    build(source, data, owner) {
      if (!data.cyclones.length) return "目前沒有活動中的颱風";
      data.cyclones.forEach((cyclone, index) => buildCyclone(source, cyclone, index, owner));
      return data.cyclones.map((c) => `${c.name} · ${cycloneClass(c.track.at(-1).wind).name}`).join("、");
    },
    info: (row) => row,
    fly: true,
    // Every track and forecast point, framed together with Taiwan.
    points: (data) => data.cyclones.flatMap((c) => [...c.track, ...c.forecast]).map((p) => [p.lon, p.lat]),
  },
};

// ---------- typhoon ----------

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

// The typhoon symbol: a ring with two trailing arms, in the colour of its class.
const symbols = new Map();
function symbolImage(css) {
  if (symbols.has(css)) return symbols.get(css);
  const size = 72;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  context.translate(size / 2, size / 2);
  context.lineCap = "round";
  for (const [stroke, width] of [["rgba(11, 18, 32, 0.85)", 10], [css, 5]]) {
    context.strokeStyle = stroke;
    context.lineWidth = width;
    context.beginPath();
    context.arc(0, 0, 10, 0, Math.PI * 2);
    context.stroke();
    for (const s of [1, -1]) {
      context.beginPath();
      context.moveTo(0, -10 * s);
      context.quadraticCurveTo(19 * s, -10 * s, 25 * s, -25 * s);
      context.stroke();
    }
  }
  symbols.set(css, canvas);
  return canvas;
}

// The name tag beside the symbol: name and class over pressure and wind, drawn
// at twice the size it is shown so it stays sharp. A label cannot have rounded
// corners or a coloured class pill.
const TAG_SCALE = 2;
function tagImage(cyclone, now) {
  const cls = cycloneClass(now.wind);
  const s = TAG_SCALE;
  const font = (weight, px) => `${weight} ${px * s}px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif`;
  const name = cyclone.name ?? "";
  const detail = `${num(now.pressure, 0, " hPa")}  ·  ${num(now.wind, 0, " m/s")}`;
  const context = document.createElement("canvas").getContext("2d");
  context.font = font(700, 15);
  const nameWidth = context.measureText(name).width;
  context.font = font(600, 11);
  const classWidth = context.measureText(cls.name).width;
  context.font = font(500, 11.5);
  const detailWidth = context.measureText(detail).width;
  const pad = 11 * s;
  const pill = classWidth + 14 * s;
  const width = Math.ceil(pad * 2 + Math.max(nameWidth + 8 * s + pill, detailWidth));
  const height = 48 * s;
  const canvas = context.canvas;
  canvas.width = width;
  canvas.height = height;

  context.beginPath();
  context.roundRect(s, s, width - 2 * s, height - 2 * s, 12 * s);
  context.fillStyle = "rgba(8, 13, 28, 0.8)";
  context.fill();
  context.lineWidth = s;
  context.strokeStyle = "rgba(255, 255, 255, 0.18)";
  context.stroke();

  context.textBaseline = "middle";
  context.fillStyle = "#f8fafc";
  context.font = font(700, 15);
  context.fillText(name, pad, 17 * s);
  const pillX = pad + nameWidth + 8 * s;
  context.beginPath();
  context.roundRect(pillX, 9 * s, pill, 16 * s, 8 * s);
  context.fillStyle = cls.color.replace(/^#(..)(..)(..)$/, (_, r, g, b) => `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, 0.2)`);
  context.fill();
  context.fillStyle = cls.color;
  context.font = font(600, 11);
  context.fillText(cls.name, pillX + 7 * s, 17.5 * s);
  context.fillStyle = "rgba(226, 232, 240, 0.78)";
  context.font = font(500, 11.5);
  context.fillText(detail, pad, 35 * s);
  return canvas;
}

// A closed ring of `km` around a point, as a polyline.
const ring = (lon, lat, km) => {
  const points = circle(lon, lat, km, 120);
  return Cesium.Cartesian3.fromDegreesArray([...points, points[0]].flat());
};

// What the hover card says about one analysed or forecast position.
function fixInfo(cyclone, p, forecast) {
  const cls = cycloneClass(p.wind);
  const level = beaufortLevel(p.wind);
  const lines = [
    ["中心氣壓", num(p.pressure, 0, " hPa")],
    ["最大風速", `${num(p.wind, 0, " m/s")}${level === null ? "" : `（${level} 級）`}`],
    ["七級風暴半徑", num(p.r15, 0, " km")],
  ];
  if (p.r25) lines.push(["十級風暴半徑", num(p.r25, 0, " km")]);
  if (forecast) lines.push(["70% 機率半徑", num(p.r70, 0, " km")]);
  else if (p.dir) lines.push(["移動", `向${directionName(p.dir)} ${num(p.speed, 0, " km/h")}`]);
  return {
    title: `${cyclone.name ?? ""} · ${cls.name}`,
    sub: forecast ? `預報 +${p.hour} 小時 · ${dayTime(p.time)}` : `${dayTime(p.time)} 定位`,
    lines,
  };
}

function buildCyclone(source, cyclone, index, owner) {
  const now = cyclone.track.at(-1);
  const nowClass = cycloneClass(now.wind);
  const properties = (row) => ({ overlay: "typhoon", cyclone: index, row });

  // The cone: the hull of each forecast point's 70% probability circle.
  if (cyclone.forecast.length) {
    const conePoints = [[now.lon, now.lat]];
    for (const f of cyclone.forecast) conePoints.push(...circle(f.lon, f.lat, f.r70 ?? 0));
    source.entities.add({
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(hull(conePoints).flat()),
        material: color("#e2e8f0", 0.09),
        outline: true,
        outlineColor: color("#e2e8f0", 0.45),
        height: 0,
      },
      properties: properties(fixInfo(cyclone, now, false)),
    });
  }

  // The past track glows, each leg in the colour of the class it reached.
  for (let i = 1; i < cyclone.track.length; i += 1) {
    const a = cyclone.track[i - 1];
    const b = cyclone.track[i];
    source.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray([a.lon, a.lat, b.lon, b.lat]),
        width: 7,
        material: new Cesium.PolylineGlowMaterialProperty({ color: color(cycloneClass(b.wind).color), glowPower: 0.22, taperPower: 1 }),
      },
    });
  }
  for (const fix of cyclone.track.slice(0, -1)) {
    source.entities.add({
      position: Cesium.Cartesian3.fromDegrees(fix.lon, fix.lat),
      point: { pixelSize: 7, color: color(cycloneClass(fix.wind).color), outlineColor: color("#0b1220", 0.85), outlineWidth: 2 },
      properties: properties(fixInfo(cyclone, fix, false)),
    });
  }

  // The forecast: dashed legs and labelled points, coloured the same way.
  const chain = [now, ...cyclone.forecast];
  for (let i = 1; i < chain.length; i += 1) {
    const a = chain[i - 1];
    const b = chain[i];
    source.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray([a.lon, a.lat, b.lon, b.lat]),
        width: 3,
        material: new Cesium.PolylineDashMaterialProperty({ color: color(cycloneClass(b.wind).color, 0.95), gapColor: Cesium.Color.TRANSPARENT, dashLength: 16 }),
      },
    });
  }
  for (const f of cyclone.forecast) {
    source.entities.add({
      position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat),
      point: { pixelSize: 9, color: color(cycloneClass(f.wind).color), outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
      label: {
        text: `+${f.hour}h`, font: "600 11px 'Noto Sans TC', sans-serif", fillColor: Cesium.Color.WHITE,
        outlineColor: color("#0b1220"), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(10, 0), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      },
      properties: properties(fixInfo(cyclone, f, true)),
    });
  }

  // Now: the gale (7級) and storm (10級) circles on the sea, under the real
  // cloud (clouds.js); the symbol and name tag on top.
  const info = fixInfo(cyclone, now, false);
  const windCircle = (km, css, fill) => {
    source.entities.add({
      position: Cesium.Cartesian3.fromDegrees(now.lon, now.lat),
      ellipse: { semiMajorAxis: km * 1000, semiMinorAxis: km * 1000, material: color(css, fill) },
      properties: properties(info),
    });
    source.entities.add({
      polyline: { positions: ring(now.lon, now.lat, km), width: 2, clampToGround: true, material: color(css, 0.9) },
    });
  };
  if (now.r15) windCircle(now.r15, "#fb923c", 0.07);
  if (now.r25) windCircle(now.r25, "#ef4444", 0.12);
  source.entities.add({
    position: Cesium.Cartesian3.fromDegrees(now.lon, now.lat, 12000),
    billboard: { image: symbolImage(nowClass.color), scale: 0.62, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    properties: properties(info),
  });
  source.entities.add({
    position: Cesium.Cartesian3.fromDegrees(now.lon, now.lat, 12000),
    // Up and to the right: typhoons here mostly come from the east-south-east
    // and head north-west, so that corner is clear of both tracks.
    billboard: {
      image: tagImage(cyclone, now), scale: 1 / TAG_SCALE,
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT, verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(20, -12), disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    properties: properties(info),
  });

  // The card's timeline marker: wherever the slider says the cyclone is.
  const ghost = () => owner.ghosts.get(index);
  const ghostAt = (height) => new Cesium.CallbackProperty(() => {
    const g = ghost() ?? now;
    return Cesium.Cartesian3.fromDegrees(g.lon, g.lat, height);
  }, false);
  source.entities.add({
    position: ghostAt(12000),
    billboard: {
      image: new Cesium.CallbackProperty(() => symbolImage(cycloneClass(ghost()?.wind).color), false),
      show: new Cesium.CallbackProperty(() => Boolean(ghost()), false),
      scale: 0.62, disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  const ghostRadius = new Cesium.CallbackProperty(() => Math.max(ghost()?.r15 ?? 1, 1) * 1000, false);
  source.entities.add({
    position: ghostAt(0),
    ellipse: {
      semiMajorAxis: ghostRadius, semiMinorAxis: ghostRadius, height: 0,
      show: new Cesium.CallbackProperty(() => Boolean(ghost()?.r15), false),
      material: color("#fb923c", 0.1), outline: true, outlineColor: color("#fdba74", 0.75),
    },
  });
}

// ---------- manager ----------

export class Overlays {
  constructor(viewer) {
    this.viewer = viewer;
    this.active = new Map(); // name → { source, status, data }
    this.pending = new Map();
    this.ghosts = new Map(); // cyclone index → the timeline marker's point
    this.brightness = 1;
  }

  // Drop a layer's data source and its imagery (the typhoon's cloud).
  discard(layer) {
    this.viewer.dataSources.remove(layer.source, true);
    for (const imagery of layer.imagery) this.viewer.imageryLayers.remove(imagery, true);
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
      if (layer) this.discard(layer);
      this.active.delete(name);
      if (name === "typhoon") this.ghosts.clear();
      this.viewer.scene.requestRender();
      return "";
    }
    const token = Symbol(name);
    this.pending.set(name, token);
    const data = await getJSON(`/api/overlays/${name}`);
    const prepared = (await definition.prepare?.(data)) ?? {};
    if (this.pending.get(name) !== token) return ""; // switched off while loading
    const source = new Cesium.CustomDataSource(name);
    const status = definition.build(source, data, this);
    const previous = this.active.get(name);
    await this.viewer.dataSources.add(source);
    const imagery = definition.imagery?.(this.viewer, data, prepared) ?? [];
    for (const layer of imagery) layer.brightness = this.brightness;
    if (previous) this.discard(previous);
    this.active.set(name, { source, status, data, imagery, ...prepared });
    this.dimClouds();
    if (definition.fly && !previous) this.frame(definition.points?.(data) ?? []);
    this.viewer.scene.requestRender();
    return status;
  }

  // Fly out so the points and Taiwan share the view. Framing is done here from
  // plain points: viewer.flyTo(dataSource) waits on every entity's bounds,
  // which never settle for the timeline marker's callback positions.
  frame(points) {
    if (!points.length) return;
    const all = [...points, [120.0, 21.9], [122.0, 25.3]]; // Taiwan's corners
    const sphere = Cesium.BoundingSphere.fromPoints(all.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)));
    this.viewer.camera.flyToBoundingSphere(sphere, {
      duration: 1.8,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-70), Math.max(sphere.radius * 2.6, 900000)),
    });
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

  /** Draped imagery darkens with the globe at night; this lifts it (see globe.js setSky). */
  setBrightness(brightness) {
    this.brightness = brightness;
    for (const layer of this.active.values()) for (const imagery of layer.imagery) imagery.brightness = brightness;
  }

  /** When the satellite picture was taken (ISO), or null when there is none. */
  cloudTime() {
    return this.active.get("typhoon")?.cloudTime ?? null;
  }

  // The satellite shows the storm now; while the timeline shows another hour,
  // its cloud steps back so the marker reads as the one to follow.
  dimClouds() {
    const typhoon = this.active.get("typhoon");
    for (const layer of typhoon?.imagery ?? []) layer.alpha = this.ghosts.size ? 0.35 : 1;
  }

  /** The active cyclones, as /api/overlays/typhoon gave them. */
  typhoons() {
    return this.active.get("typhoon")?.data.cyclones ?? [];
  }

  /** Put cyclone `index`'s timeline marker at `point` ({lon, lat, wind, r15}), or hide it. */
  scrub(index, point) {
    if (point) this.ghosts.set(index, point);
    else this.ghosts.delete(index);
    this.dimClouds();
    this.viewer.scene.requestRender();
  }

  /** Which overlay (and cyclone) a pick landed on, or null. */
  hit(picked) {
    const properties = picked?.id?.properties;
    const name = properties?.overlay?.getValue?.();
    if (!name || !DEFINITIONS[name]) return null;
    return { name, cyclone: properties.cyclone?.getValue?.() };
  }

  /** The hover card for a picked overlay entity, or null. */
  infoFor(picked) {
    const properties = picked?.id?.properties;
    const name = properties?.overlay?.getValue?.();
    if (!name || !DEFINITIONS[name]) return null;
    return DEFINITIONS[name].info(properties.row.getValue());
  }
}
