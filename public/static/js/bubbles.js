// Glass value bubbles floating over each county.
//
// They are HTML, not Cesium labels. After every frame each anchor (a ground
// point, lifted by the exaggerated terrain height) is projected to the
// screen and every county on screen gets its bubble. Nearest the spine first, each
// takes the first free place, clear of the bubbles already placed, the other
// counties' points and the floating chrome: above its county; else beside it;
// else out to sea, away from the island's spine (the line from Fugui Cape to
// Eluanbi): west-coast counties go west, east-coast ones east, and the
// crowded north fans out from the northern tip. Their leader lines (a
// hairline ending in a dot on the county) then do not cross the island.
/* global Cesium */
import { escapeHtml } from "./format.js";
import { colorAt } from "./scale.js";

const FAR = 260000; // camera height in metres above which names are shortened
const GAP = 4;
// Floating chrome that bubbles must not slide underneath.
const OBSTACLES = ".topbar, .controls, .panel:not([hidden]), .typhoon-card:not([hidden])";
const SVG_NS = "http://www.w3.org/2000/svg";
// A bubble sits this far above its county's point when it has room there.
const LIFT = 8;
// The main island's spine, north tip to south tip; displaced bubbles move away from it.
const SPINE = [{ lon: 121.54, lat: 25.29 }, { lon: 120.84, lat: 21.9 }];
// Out along the ray away from the spine: distances from the county in
// pixels, and turns off the ray in degrees, alternating either side.
// Counties are placed nearest the spine first: inland ones have nowhere to
// go but across the island, while coastal ones can move out to sea. The
// selected county goes before all of them.
const REACH = [34, 52, 72, 96, 124, 156, 192];
const TURNS = [0, 18, -18, 36, -36, 56, -56, 80, -80];

function shortNames(names) {
  const stems = names.map((name) => name.replace(/[市縣]$/, ""));
  return new Map(names.map((name, i) => [name, stems.filter((s) => s === stems[i]).length > 1 ? name : stems[i]]));
}

const overlaps = (a, b) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

export class Bubbles {
  constructor(container, viewer, anchors, { onHover, onSelect }) {
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.layer = document.createElement("div");
    this.layer.className = "bubbles";
    container.append(this.layer);
    // Leader lines, under the bubbles.
    this.leaders = document.createElementNS(SVG_NS, "svg");
    this.leaders.setAttribute("class", "bubble-leaders");
    this.leaders.setAttribute("aria-hidden", "true");
    this.layer.append(this.leaders);
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
      const leader = document.createElementNS(SVG_NS, "g");
      leader.innerHTML = `<line/><circle r="2.6"/>`;
      leader.style.display = "none";
      this.leaders.append(leader);
      this.items.set(name, { element, leader, lon, lat, height: 0, size: null, spot: null });
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
      const color = colorAt(scale, value);
      item.element.querySelector(".value").textContent = text;
      item.element.querySelector(".dot").style.background = color;
      item.leader.querySelector("circle").style.fill = color;
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
      this.layer.classList.toggle("far", far);
      for (const [name, item] of this.items) {
        item.element.querySelector(".name").textContent = far ? this.short.get(name) : name;
        item.size = null;
      }
    }

    // ---- reads ----
    const chrome = [...document.querySelectorAll(OBSTACLES)].map((el) => {
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

    // Every county's point first: a bubble must not cover another county's
    // point either, or its leader would have nowhere to land.
    const points = new Map();
    for (const [name, item] of this.items) {
      // Heights are stored unexaggerated; the exaggeration eases with camera height.
      const lifted = item.height * this.scene.verticalExaggeration + 150;
      const world = Cesium.Cartesian3.fromDegrees(item.lon, item.lat, lifted);
      const screen = this.scene.mode === Cesium.SceneMode.SCENE3D && !occluder.isPointVisible(world)
        ? undefined
        : this.toWindow(this.scene, world);
      if (screen && screen.x >= 0 && screen.y >= 0 && screen.x <= width && screen.y <= height) points.set(name, { x: screen.x, y: screen.y });
    }
    const marks = [...points.values()].map((p) => ({ x: p.x - 3, y: p.y - 3, w: 6, h: 6 }));
    const [tipA, tipB] = SPINE.map(({ lon, lat }) => this.toWindow(this.scene, Cesium.Cartesian3.fromDegrees(lon, lat, 0)));
    // Away from the nearest point of the spine; a county on the spine itself
    // (Nantou) goes to the side of the spine with the open east coast.
    const fromSpine = (point) => {
      if (!tipA || !tipB) return { distance: 0, outward: -Math.PI / 2 };
      const ax = tipB.x - tipA.x;
      const ay = tipB.y - tipA.y;
      const t = Math.min(Math.max(((point.x - tipA.x) * ax + (point.y - tipA.y) * ay) / (ax * ax + ay * ay || 1), 0), 1);
      const dx = point.x - (tipA.x + ax * t);
      const dy = point.y - (tipA.y + ay * t);
      const distance = Math.hypot(dx, dy);
      if (distance > 12) return { distance, outward: Math.atan2(dy, dx) };
      // Perpendicular to the spine, towards the east (screen right when north is up).
      const side = Math.atan2(ax, -ay);
      return { distance, outward: Math.cos(side) >= 0 ? side : side + Math.PI };
    };
    const spine = new Map([...points].map(([name, point]) => [name, fromSpine(point)]));
    const placing = [...points.keys()].sort((a, b) =>
      (b === this.selected) - (a === this.selected) || spine.get(a).distance - spine.get(b).distance);

    const placed = [...chrome];
    const plan = [];
    for (const [name, item] of this.items) {
      if (points.has(name)) continue;
      item.spot = null;
      plan.push([item, null]);
    }
    for (const name of placing) {
      const item = this.items.get(name);
      const point = points.get(name);
      const { w, h } = item.size;
      const own = marks.filter((m) => Math.abs(m.x + 3 - point.x) > 0.5 || Math.abs(m.y + 3 - point.y) > 0.5);
      const fits = (box) => box.x >= 0 && box.y >= 0 && box.x + box.w <= width && box.y + box.h <= height
        && !placed.some((p) => overlaps(box, p)) && !own.some((m) => overlaps(box, m));
      // Places, as the box's centre relative to the county's point.
      const { outward } = spine.get(name);
      const candidates = [
        ["above", 0, -(h / 2 + LIFT)],
        ["right", w / 2 + 8, 0],
        ["left", -(w / 2 + 8), 0],
        ["below", 0, h / 2 + LIFT],
      ];
      for (const reach of REACH) {
        for (const turn of TURNS) {
          const angle = outward + (turn * Math.PI) / 180;
          // Far enough along the ray that the box, not its centre, clears the point.
          const along = reach + Math.abs(Math.cos(angle)) * w / 2 + Math.abs(Math.sin(angle)) * h / 2;
          candidates.push([`${reach}:${turn}`, Math.cos(angle) * along, Math.sin(angle) * along]);
        }
      }
      const boxOf = ([, dx, dy]) => ({ x: point.x + dx - w / 2, y: point.y + dy - h / 2, w, h });
      // Above its county if free; otherwise last frame's place, so bubbles do
      // not hop about while the camera moves; otherwise the first free one.
      // With nowhere free it stays above its county, overlapping, but shown.
      let choice = candidates[0];
      if (!fits(boxOf(choice))) {
        const previous = item.spot && candidates.find((c) => c[0] === item.spot);
        choice = (previous && fits(boxOf(previous)) ? previous : candidates.find((c) => fits(boxOf(c)))) ?? candidates[0];
      }
      item.spot = choice[0];
      const box = boxOf(choice);
      placed.push(box);
      plan.push([item, box, point, choice[0] !== "above"]);
    }

    // ---- writes ----
    for (const [item, box, point, moved] of plan) {
      const tucked = box === null;
      if (item.tucked !== tucked) {
        item.tucked = tucked;
        item.element.classList.toggle("tucked", tucked);
      }
      if (tucked) {
        if (item.leaderShown) {
          item.leaderShown = false;
          item.leader.style.display = "none";
        }
        continue;
      }
      const transform = `translate(${box.x.toFixed(1)}px, ${box.y.toFixed(1)}px)`;
      if (item.transform !== transform) {
        item.transform = transform;
        item.element.style.transform = transform;
      }
      if (moved !== Boolean(item.leaderShown)) {
        item.leaderShown = moved;
        item.leader.style.display = moved ? "" : "none";
      }
      if (moved) {
        // From the point on the bubble's edge nearest the county to the county.
        const ex = Math.min(Math.max(point.x, box.x + 10), box.x + box.w - 10);
        const ey = Math.min(Math.max(point.y, box.y), box.y + box.h);
        const key = `${ex.toFixed(1)},${ey.toFixed(1)},${point.x.toFixed(1)},${point.y.toFixed(1)}`;
        if (item.leaderKey !== key) {
          item.leaderKey = key;
          const [line, dot] = item.leader.children;
          line.setAttribute("x1", ex.toFixed(1));
          line.setAttribute("y1", ey.toFixed(1));
          line.setAttribute("x2", point.x.toFixed(1));
          line.setAttribute("y2", point.y.toFixed(1));
          dot.setAttribute("cx", point.x.toFixed(1));
          dot.setAttribute("cy", point.y.toFixed(1));
        }
      }
    }
  }
}
