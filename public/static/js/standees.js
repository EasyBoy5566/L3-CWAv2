// County standees: a glass sign on a thin stem, stood on the ground at each
// county's label point (scripts/build_geo.py), showing its name and value.
//
// They are part of the 3D scene, like models in the landscape, not an HTML
// layer over it: nearer ones stand in front of farther ones, farther ones get
// smaller (and harder to hit), and none of them is ever moved or hidden to
// make room. So there is no layout to work out, nothing jumps as the camera
// moves, and nothing is done per frame but the GPU drawing them.
/* global Cesium */
import { colorAt } from "./scale.js";

// Drawn at this multiple of their on-screen size, so the text stays sharp.
const PIXEL_RATIO = 2;
// On-screen size by camera distance: a little over full size from 100 km in,
// full size at the default view (about 600 km away), and shrinking to under
// half of it 2,000 km out.
const SCALE = new Cesium.NearFarScalar(100000, 1.15 / PIXEL_RATIO, 2000000, 0.45 / PIXEL_RATIO);
// The stem, in on-screen pixels at full size, from the sign to the ground.
const STEM = 22;
const FONT = "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif";

// One sign, drawn on a canvas: a rounded glass pill with the value's colour
// dot, the name and the value, on a stem that ends in a small foot.
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
  const pad = 10 * s;
  const dot = 10 * s;
  const gap = 6 * s;
  const pillHeight = 30 * s;
  const pillWidth = Math.ceil(pad + dot + gap + nameWidth + gap + approxWidth + valueWidth + pad);
  const stem = STEM * s;
  const canvas = context.canvas;
  canvas.width = pillWidth + 4 * s;
  canvas.height = pillHeight + stem + 4 * s;
  const x0 = 2 * s;
  const y0 = 2 * s;
  const mid = x0 + pillWidth / 2;

  // Stem and foot.
  context.strokeStyle = "rgba(255, 255, 255, 0.85)";
  context.lineWidth = 1.5 * s;
  context.beginPath();
  context.moveTo(mid, y0 + pillHeight);
  context.lineTo(mid, canvas.height - 3 * s);
  context.stroke();
  context.fillStyle = "rgba(255, 255, 255, 0.9)";
  context.beginPath();
  context.ellipse(mid, canvas.height - 3 * s, 3 * s, 1.6 * s, 0, 0, Math.PI * 2);
  context.fill();

  // Pill: opaque, so nearer signs cleanly cover farther ones.
  context.beginPath();
  context.roundRect(x0, y0, pillWidth, pillHeight, pillHeight / 2);
  const fill = context.createLinearGradient(0, y0, 0, y0 + pillHeight);
  fill.addColorStop(0, "rgb(34, 46, 74)");
  fill.addColorStop(1, "rgb(16, 24, 44)");
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = s * (selected ? 2 : 1);
  context.strokeStyle = selected ? "rgba(254, 240, 138, 0.95)" : "rgba(255, 255, 255, 0.45)";
  context.stroke();
  // Sheen along the top edge.
  context.save();
  context.clip();
  const sheen = context.createLinearGradient(0, y0, 0, y0 + pillHeight * 0.55);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.22)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = sheen;
  context.fillRect(x0, y0, pillWidth, pillHeight * 0.55);
  context.restore();

  // Dot, name, value.
  const cy = y0 + pillHeight / 2;
  let x = x0 + pad;
  context.fillStyle = color;
  context.beginPath();
  context.arc(x + dot / 2, cy, dot / 2, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.4)";
  context.lineWidth = 1.5 * s;
  context.stroke();
  x += dot + gap;
  context.textBaseline = "middle";
  context.font = nameFont;
  context.fillStyle = selected ? "#f8fafc" : "rgba(226, 232, 240, 0.78)";
  context.fillText(name, x, cy + 0.5 * s);
  x += nameWidth + gap;
  if (approx) {
    context.font = smallFont;
    context.fillStyle = "rgba(226, 232, 240, 0.78)";
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
    for (const [name, { lon, lat }] of anchors) {
      const billboard = this.collection.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        scaleByDistance: SCALE,
        scale: 1,
        // A little towards the camera, so the foot is not lost in the ground it stands on.
        eyeOffset: new Cesium.Cartesian3(0, 0, -300),
        id: { county: name },
      });
      this.items.set(name, { billboard, lon, lat, height: 0, state: { name, text: "—", color: "#64748b", approx: false, selected: false } });
    }
    for (const item of this.items.values()) this.draw(item);
    // Standing on the terrain as it is drawn: exaggerated from afar, easing to
    // true scale close in.
    this.scene.preRender.addEventListener(() => this.stand());
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
    item.billboard.setImage(`${key}${force ? "|f" : ""}`, drawSign(item.state));
  }

  stand() {
    const exaggeration = this.scene.verticalExaggeration;
    if (exaggeration === this.exaggeration) return;
    this.exaggeration = exaggeration;
    for (const item of this.items.values()) {
      item.billboard.position = Cesium.Cartesian3.fromDegrees(item.lon, item.lat, item.height * exaggeration);
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
