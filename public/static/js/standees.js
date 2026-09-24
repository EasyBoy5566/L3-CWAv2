// County standees: a liquid-glass sign stood at each county's label point
// (scripts/build_geo.py), showing its name and value.
//
// They are part of the 3D scene, like models in the landscape, not an HTML
// layer over it: nearer ones stand in front of farther ones, farther ones get
// smaller (and harder to hit), and none of them is ever moved or hidden to
// make room. So there is no layout to work out, nothing jumps as the camera
// moves, and there are no leader lines.
//
// The glass is the page's (style.css .glass): a see-through navy tint, a rim
// brightest at the top left, a sheen and a specular spot along the top, a
// glow along the bottom. WebGL cannot blur what lies behind a billboard; the
// tint is kept light so the map shows through, and the text has a dark halo.
/* global Cesium */
import { colorAt } from "./scale.js";

// Drawn at this multiple of their on-screen size, so the text stays sharp.
const PIXEL_RATIO = 2;
// On-screen size by camera distance: a little over full size from 100 km in,
// full size at the default view (about 600 km away), and shrinking to under
// half of it 2,000 km out.
const SCALE = new Cesium.NearFarScalar(100000, 1.15 / PIXEL_RATIO, 2000000, 0.45 / PIXEL_RATIO);
const FONT = "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif";
// Room around the pill for its shadow and glow, in on-screen pixels.
const MARGIN = 8;

// One sign, drawn on a canvas: a rounded glass pill with the value's colour
// dot, the name and the value.
function drawSign({ name, text, color, approx, selected }) {
  const s = PIXEL_RATIO;
  const context = document.createElement("canvas").getContext("2d");
  const nameFont = `500 ${13 * s}px ${FONT}`;
  const valueFont = `700 ${16 * s}px ${FONT}`;
  const smallFont = `500 ${11 * s}px ${FONT}`;
  context.font = nameFont;
  const nameWidth = context.measureText(name).width;
  context.font = valueFont;
  const valueWidth = context.measureText(text).width;
  context.font = smallFont;
  const approxWidth = approx ? context.measureText("約").width + 2 * s : 0;
  const pad = 11 * s;
  const dot = 10 * s;
  const gap = 6 * s;
  const h = 30 * s;
  const w = Math.ceil(pad + dot + gap + nameWidth + gap + approxWidth + valueWidth + pad);
  const m = MARGIN * s;
  const canvas = context.canvas;
  canvas.width = w + m * 2;
  canvas.height = h + m * 2;
  const x0 = m;
  const y0 = m;
  const r = h / 2;
  const pill = () => {
    context.beginPath();
    context.roundRect(x0, y0, w, h, r);
  };

  // A soft shadow under the glass, lifting it off the map.
  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.3)";
  context.shadowBlur = 7 * s;
  context.shadowOffsetY = 2 * s;
  pill();
  context.fillStyle = "rgba(8, 12, 26, 0.18)";
  context.fill();
  context.restore();

  // The glass: a see-through navy tint, deeper towards the bottom.
  pill();
  const tint = context.createLinearGradient(0, y0, 0, y0 + h);
  tint.addColorStop(0, "rgba(34, 48, 84, 0.24)");
  tint.addColorStop(1, "rgba(12, 18, 38, 0.4)");
  context.fillStyle = tint;
  context.fill();

  context.save();
  pill();
  context.clip();
  // Sheen: light pooling along the top of the lens.
  const sheen = context.createLinearGradient(0, y0, 0, y0 + h * 0.6);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.3)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = sheen;
  context.fillRect(x0, y0, w, h * 0.6);
  // Specular spot near the top left, where the light strikes the curve.
  const spot = context.createRadialGradient(x0 + r * 1.1, y0 + h * 0.18, 0, x0 + r * 1.1, y0 + h * 0.18, r * 1.6);
  spot.addColorStop(0, "rgba(255, 255, 255, 0.35)");
  spot.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = spot;
  context.fillRect(x0, y0, w, h);
  // Light passing through, gathering along the bottom edge.
  const glow = context.createLinearGradient(0, y0 + h, 0, y0 + h * 0.55);
  glow.addColorStop(0, "rgba(255, 255, 255, 0.16)");
  glow.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = glow;
  context.fillRect(x0, y0 + h * 0.55, w, h * 0.45);
  context.restore();

  // Rim: brightest where the light hits (top left), faint across, bright
  // again at the bottom right; gold when the county is selected.
  pill();
  const rim = context.createLinearGradient(x0, y0, x0 + w, y0 + h);
  if (selected) {
    rim.addColorStop(0, "rgba(254, 249, 195, 1)");
    rim.addColorStop(1, "rgba(250, 204, 21, 0.9)");
  } else {
    rim.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    rim.addColorStop(0.3, "rgba(255, 255, 255, 0.18)");
    rim.addColorStop(0.7, "rgba(255, 255, 255, 0.12)");
    rim.addColorStop(1, "rgba(255, 255, 255, 0.55)");
  }
  context.lineWidth = (selected ? 2 : 1.2) * s;
  context.strokeStyle = rim;
  context.stroke();
  if (selected) {
    context.save();
    context.shadowColor = "rgba(250, 204, 21, 0.8)";
    context.shadowBlur = 8 * s;
    context.stroke();
    context.restore();
  }

  // Dot, name, value, with a faint shadow to read over bright ground.
  const cy = y0 + h / 2;
  let x = x0 + pad;
  context.save();
  context.shadowColor = color;
  context.shadowBlur = 6 * s;
  context.fillStyle = color;
  context.beginPath();
  context.arc(x + dot / 2, cy, dot / 2, 0, Math.PI * 2);
  context.fill();
  context.restore();
  context.strokeStyle = "rgba(255, 255, 255, 0.5)";
  context.lineWidth = 1.5 * s;
  context.beginPath();
  context.arc(x + dot / 2, cy, dot / 2, 0, Math.PI * 2);
  context.stroke();
  x += dot + gap;
  // The glass is clear enough that text needs its own dark halo to read over bright ground.
  context.shadowColor = "rgba(0, 0, 0, 0.9)";
  context.shadowBlur = 4 * s;
  context.shadowOffsetY = 1 * s;
  context.textBaseline = "middle";
  context.font = nameFont;
  context.fillStyle = selected ? "#f8fafc" : "rgba(241, 245, 249, 0.92)";
  context.fillText(name, x, cy + 0.5 * s);
  x += nameWidth + gap;
  if (approx) {
    context.font = smallFont;
    context.fillStyle = "rgba(226, 232, 240, 0.8)";
    context.fillText("約", x, cy + 1 * s);
    x += approxWidth;
  }
  context.font = valueFont;
  context.fillStyle = "#f8fafc";
  context.fillText(text, x, cy + 0.5 * s);
  return canvas;
}

export class Standees {
  constructor(viewer, anchors) {
    this.scene = viewer.scene;
    this.collection = this.scene.primitives.add(new Cesium.BillboardCollection({ scene: this.scene }));
    this.items = new Map();
    this.selected = null;
    this.exaggeration = null;
    this.order = "";
    for (const [name, { lon, lat }] of anchors) {
      this.items.set(name, {
        name, lon, lat, height: 0, billboard: null, canvas: null, image: null,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        state: { name, text: "—", color: "#64748b", approx: false, selected: false },
      });
    }
    for (const item of this.items.values()) this.draw(item);
    this.scene.preRender.addEventListener(() => this.update());
    // Fonts may still be loading when the first signs are drawn.
    document.fonts?.ready.then(() => {
      for (const item of this.items.values()) this.draw(item, true);
      this.scene.requestRender();
    });
  }

  draw(item, force = false) {
    const key = JSON.stringify(item.state);
    if (!force && key === item.key) return;
    item.key = key;
    // Each distinct look is its own image in the billboard atlas; values
    // change rarely, so the atlas stays small.
    item.image = `${key}${force ? "|f" : ""}`;
    item.canvas = drawSign(item.state);
    item.billboard?.setImage(item.image, item.canvas);
  }

  // Before each frame: stand on the terrain as it is drawn (exaggerated from
  // afar, easing to true scale close in), and keep the signs in painter's
  // order. The glass is see-through, and see-through billboards are blended
  // in the order they are drawn, so the farthest must be drawn first for the
  // nearer ones to show over them.
  update() {
    const exaggeration = this.scene.verticalExaggeration;
    const moved = exaggeration !== this.exaggeration;
    if (moved) {
      this.exaggeration = exaggeration;
      for (const item of this.items.values()) {
        item.position = Cesium.Cartesian3.fromDegrees(item.lon, item.lat, item.height * exaggeration);
        if (item.billboard) item.billboard.position = item.position;
      }
    }
    const eye = this.scene.camera.positionWC;
    const far = [...this.items.values()]
      .map((item) => [item, Cesium.Cartesian3.distanceSquared(eye, item.position)])
      .sort((a, b) => b[1] - a[1])
      .map(([item]) => item);
    const order = far.map((item) => item.name).join();
    if (order === this.order) return;
    this.order = order;
    // Re-added in order; their images are already in the atlas.
    this.collection.removeAll();
    for (const item of far) {
      item.billboard = this.collection.add({
        position: item.position,
        scaleByDistance: SCALE,
        // A little towards the camera, so the ground it sits on does not cut into it.
        eyeOffset: new Cesium.Cartesian3(0, 0, -300),
        id: { county: item.name },
      });
      item.billboard.setImage(item.image, item.canvas);
    }
  }

  /** Ground heights in metres, as the terrain has them before exaggeration. */
  setHeights(heights) {
    for (const [name, height] of heights) {
      const item = this.items.get(name);
      if (item) item.height = height;
    }
    this.exaggeration = null;
    this.scene.requestRender();
  }

  setValues(layer, values, scale) {
    for (const [name, item] of this.items) {
      const value = values[name]?.value ?? null;
      const digits = layer === "now" ? 1 : 0;
      item.state = {
        ...item.state,
        text: value === null ? "—" : `${Number(value).toFixed(layer === "pop" ? 0 : digits)}${scale.unit}`,
        color: colorAt(scale, value),
        approx: Boolean(values[name]?.approx),
      };
      this.draw(item);
    }
    this.scene.requestRender();
  }

  select(name) {
    this.selected = name;
    for (const [key, item] of this.items) {
      if (item.state.selected === (key === name)) continue;
      item.state = { ...item.state, selected: key === name };
      this.draw(item);
    }
    this.scene.requestRender();
  }

  /** The county whose standee was picked, or null. */
  countyOf(picked) {
    return picked?.primitive && picked.collection === this.collection ? picked.id?.county ?? null : null;
  }
}
