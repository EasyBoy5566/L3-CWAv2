// Glass value bubbles floating over each county.
//
// They are HTML, not Cesium labels, so they get real backdrop blur. After
// every frame each anchor (a ground point, lifted by the exaggerated terrain
// height) is projected to the screen; bubbles are placed in priority order
// and any that would overlap an already placed one, or the floating controls,
// is tucked away until the camera comes closer.
/* global Cesium */
import { escapeHtml } from "./format.js";
import { colorAt } from "./scale.js";

// Municipalities first, then north to south; the selected county always wins.
// Yilan, Hualien and Taitung sit alone on the east coast; they come early so
// the crowded north does not crowd them out.
const PRIORITY = ["臺北市", "新北市", "宜蘭縣", "桃園市", "臺中市", "臺南市", "高雄市", "花蓮縣", "臺東縣", "基隆市", "新竹市", "新竹縣", "苗栗縣", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "屏東縣", "澎湖縣", "金門縣", "連江縣"];
const FAR = 260000; // camera height in metres above which names are shortened
const GAP = 4;
// Floating chrome that bubbles must not slide underneath.
const OBSTACLES = ".topbar, .controls, .panel:not([hidden]), .typhoon-card:not([hidden])";

function shortNames(names) {
  const stems = names.map((name) => name.replace(/[市縣]$/, ""));
  return new Map(names.map((name, i) => [name, stems.filter((s) => s === stems[i]).length > 1 ? name : stems[i]]));
}

export class Bubbles {
  constructor(container, viewer, anchors, { onHover, onSelect }) {
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.layer = document.createElement("div");
    this.layer.className = "bubbles";
    container.append(this.layer);
    this.short = shortNames([...anchors.keys()]);
    this.items = new Map();
    this.selected = null;
    this.toWindow = Cesium.SceneTransforms.worldToWindowCoordinates ?? Cesium.SceneTransforms.wgs84ToWindowCoordinates;

    for (const [name, { lon, lat }] of anchors) {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "bubble glass";
      element.dataset.name = name;
      element.innerHTML = `<i class="dot"></i><span class="name">${escapeHtml(name)}</span><b class="value">—</b>`;
      element.addEventListener("click", (event) => onSelect?.(name, { x: event.clientX, y: event.clientY }));
      element.addEventListener("mouseenter", (event) => onHover?.(name, { x: event.clientX, y: event.clientY }));
      element.addEventListener("mouseleave", () => onHover?.(null));
      this.layer.append(element);
      this.items.set(name, { element, lon, lat, height: 0, size: null });
    }
    this.scene.postRender.addEventListener(() => this.update());
  }

  /** Ground heights in metres, as the terrain has them before exaggeration. */
  setHeights(heights) {
    for (const [name, height] of heights) {
      const item = this.items.get(name);
      if (item) item.height = height;
    }
    this.scene.requestRender();
  }

  setValues(layer, values, scale) {
    for (const [name, item] of this.items) {
      const value = values[name]?.value ?? null;
      const digits = layer === "now" ? 1 : 0;
      const text = value === null ? "—" : `${Number(value).toFixed(layer === "pop" ? 0 : digits)}${scale.unit}`;
      item.element.querySelector(".value").textContent = text;
      item.element.querySelector(".dot").style.background = colorAt(scale, value);
      item.element.classList.toggle("approx", Boolean(values[name]?.approx));
      item.size = null;
    }
    this.scene.requestRender();
  }

  select(name) {
    this.selected = name;
    for (const [key, item] of this.items) item.element.classList.toggle("selected", key === name);
    this.scene.requestRender();
  }

  // Runs after every frame, so it must not make the browser lay the page out
  // more than once: every measurement (the chrome's boxes, bubble sizes, and
  // the canvas size Cesium's projection reads) happens before any write, and
  // only what changed is written. Interleaving them cost a full layout per
  // bubble, 22 per frame.
  update() {
    const camera = this.scene.camera;
    const far = camera.positionCartographic.height > FAR;
    if (far !== this.far) {
      this.far = far;
      for (const [name, item] of this.items) {
        item.element.querySelector(".name").textContent = far ? this.short.get(name) : name;
        item.size = null;
      }
    }

    // ---- reads ----
    const placed = [...document.querySelectorAll(OBSTACLES)].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    for (const item of this.items.values()) {
      if (!item.size) item.size = { w: item.element.offsetWidth, h: item.element.offsetHeight };
    }
    const canvas = this.scene.canvas;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, camera.positionWC);
    const order = [...this.items.keys()].sort((a, b) =>
      (b === this.selected) - (a === this.selected) || PRIORITY.indexOf(a) - PRIORITY.indexOf(b));
    const plan = [];
    for (const name of order) {
      const item = this.items.get(name);
      // Heights are stored unexaggerated; the exaggeration eases with camera height.
      const lifted = item.height * this.scene.verticalExaggeration + 150;
      const world = Cesium.Cartesian3.fromDegrees(item.lon, item.lat, lifted);
      const screen = this.scene.mode === Cesium.SceneMode.SCENE3D && !occluder.isPointVisible(world)
        ? undefined
        : this.toWindow(this.scene, world);
      if (!screen || screen.x < 0 || screen.y < 0 || screen.x > width || screen.y > height) {
        plan.push([item, null]);
        continue;
      }
      const box = { x: screen.x - item.size.w / 2, y: screen.y - item.size.h - 8, w: item.size.w, h: item.size.h };
      const clash = placed.some((p) => box.x < p.x + p.w + GAP && p.x < box.x + box.w + GAP && box.y < p.y + p.h + GAP && p.y < box.y + box.h + GAP);
      if (clash) {
        plan.push([item, null]);
        continue;
      }
      placed.push(box);
      plan.push([item, `translate(${box.x.toFixed(1)}px, ${box.y.toFixed(1)}px)`]);
    }

    // ---- writes ----
    for (const [item, transform] of plan) {
      const tucked = transform === null;
      if (item.tucked !== tucked) {
        item.tucked = tucked;
        item.element.classList.toggle("tucked", tucked);
      }
      if (transform && item.transform !== transform) {
        item.transform = transform;
        item.element.style.transform = transform;
      }
    }
  }
}
