// Glass value bubbles floating over each county.
//
// They are HTML, not Cesium labels. After every frame each anchor (a ground
// point, lifted by the exaggerated terrain height) is projected to the
// screen, and every county whose point can be seen gets its bubble: one
// off screen, or under the floating chrome, gets none.
//
// Where each bubble goes is worked out only when the view settles (the camera
// stops, a panel opens, the values or the window change). Nearest the island's
// spine first, each takes the first free place, clear of the bubbles already
// placed, the other counties' points and the floating chrome: above its
// county; else beside it; else out to sea, away from the spine (Fugui Cape to
// Eluanbi), so west-coast counties go west, east-coast ones east, and the
// crowded north fans out from the northern tip. A bubble away from its county
// is tied to it by a hairline ending in a dot. Bubbles glide to new places.
//
// While the camera moves nothing is re-placed: each bubble keeps its offset
// from its county and travels with it, so none of them jump about. A county
// that comes into view meanwhile is given a free place of its own.
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
// How far inside the map (clear of edges and panels) a county's point must be for its bubble to show.
const EDGE = 12;
// The main island's spine, north tip to south tip; displaced bubbles move away from it.
const SPINE = [{ lon: 121.54, lat: 25.29 }, { lon: 120.84, lat: 21.9 }];
// Out along the ray away from the spine: distances from the county in
// pixels, and turns off the ray in degrees, alternating either side.
const REACH = [34, 52, 72, 96, 124, 156, 192];
const TURNS = [0, 18, -18, 36, -36, 56, -56, 80, -80];
// Only when nothing out to sea is free (a county near the screen's edge,
// say): the rest of the way round, and further.
const LAST_REACH = [...REACH, 240, 300];
const LAST_TURNS = [105, -105, 130, -130, 155, -155, 180];
// How long a bubble takes to glide to a new place.
const SETTLE_MS = 380;
const easeOut = (t) => 1 - (1 - t) ** 3;

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
    this.dirty = true;
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
      this.items.set(name, { element, leader, lon, lat, height: 0, size: null, offset: null, spot: null });
    }
    // Scrolling over a bubble zooms the map, as it does anywhere else: Cesium
    // listens on its canvas, which the bubbles sit above. It zooms towards
    // the last pointer position it saw there, so it is told that first.
    this.layer.addEventListener("wheel", (event) => {
      event.preventDefault();
      const { clientX, clientY, screenX, screenY } = event;
      this.scene.canvas.dispatchEvent(new PointerEvent("pointermove", { clientX, clientY, screenX, screenY, pointerType: "mouse", isPrimary: true, bubbles: true }));
      this.scene.canvas.dispatchEvent(new WheelEvent("wheel", event));
    }, { passive: false });
    this.scene.postRender.addEventListener(() => this.update());
    this.scene.camera.moveEnd.addEventListener(() => this.relayout());
    this.scene.morphComplete.addEventListener(() => this.relayout());
    window.addEventListener("resize", () => this.relayout());
  }

  /** Work out every bubble's place again on the next frame. */
  relayout() {
    this.dirty = true;
    this.scene.requestRender();
  }

  /** Ground heights in metres, as the terrain has them before exaggeration. */
  setHeights(heights) {
    for (const [name, height] of heights) {
      const item = this.items.get(name);
      if (item) item.height = height;
    }
    this.relayout();
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
    this.relayout();
  }

  select(name) {
    this.selected = name;
    for (const [key, item] of this.items) item.element.classList.toggle("selected", key === name);
    this.relayout();
  }

  // The places for `names`, as offsets of each box from its county's point,
  // given boxes already taken. See the comment at the top.
  solve(names, points, taken, width, height) {
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
    const spine = new Map(names.map((name) => [name, fromSpine(points.get(name))]));
    const order = [...names].sort((a, b) =>
      (b === this.selected) - (a === this.selected) || spine.get(a).distance - spine.get(b).distance);

    const placed = [...taken];
    const result = new Map();
    for (const name of order) {
      const item = this.items.get(name);
      const point = points.get(name);
      const { w, h } = item.size;
      const others = marks.filter((m) => Math.abs(m.x + 3 - point.x) > 0.5 || Math.abs(m.y + 3 - point.y) > 0.5);
      const fits = (box) => box.x >= 0 && box.y >= 0 && box.x + box.w <= width && box.y + box.h <= height
        && !placed.some((p) => overlaps(box, p)) && !others.some((m) => overlaps(box, m));
      // Places, as the box's centre relative to the county's point.
      const { outward } = spine.get(name);
      const candidates = [
        ["above", 0, -(h / 2 + LIFT)],
        ["right", w / 2 + 8, 0],
        ["left", -(w / 2 + 8), 0],
        ["below", 0, h / 2 + LIFT],
      ];
      const ray = (reach, turn) => {
        const angle = outward + (turn * Math.PI) / 180;
        // Far enough along the ray that the box, not its centre, clears the point.
        const along = reach + Math.abs(Math.cos(angle)) * w / 2 + Math.abs(Math.sin(angle)) * h / 2;
        candidates.push([`${reach}:${turn}`, Math.cos(angle) * along, Math.sin(angle) * along]);
      };
      for (const reach of REACH) for (const turn of TURNS) ray(reach, turn);
      for (const reach of LAST_REACH) for (const turn of [...(reach > REACH.at(-1) ? TURNS : []), ...LAST_TURNS]) ray(reach, turn);
      const boxOf = ([, dx, dy]) => ({ x: point.x + dx - w / 2, y: point.y + dy - h / 2, w, h });
      // Above its county if free; otherwise the place it had, if still free;
      // otherwise the first free one. With nowhere free it stays above its
      // county, overlapping, but shown.
      let choice = candidates[0];
      if (!fits(boxOf(choice))) {
        const previous = item.spot && candidates.find((c) => c[0] === item.spot);
        choice = (previous && fits(boxOf(previous)) ? previous : candidates.find((c) => fits(boxOf(c)))) ?? candidates[0];
      }
      const box = boxOf(choice);
      placed.push(box);
      result.set(name, { spot: choice[0], dx: box.x - point.x, dy: box.y - point.y });
    }
    return result;
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
      // Only the camera crosses this height, and it relays out when it stops.
    }

    // ---- reads ----
    const chrome = [...document.querySelectorAll(OBSTACLES)].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const chromeKey = chrome.map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`).join(";");
    if (chromeKey !== this.chromeKey) {
      this.chromeKey = chromeKey;
      this.dirty = true; // a panel opened, closed or moved
    }
    for (const item of this.items.values()) {
      if (!item.size) item.size = { w: item.element.offsetWidth, h: item.element.offsetHeight };
    }
    const canvas = this.scene.canvas;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, camera.positionWC);
    const points = new Map();
    for (const [name, item] of this.items) {
      // Heights are stored unexaggerated; the exaggeration eases with camera height.
      const lifted = item.height * this.scene.verticalExaggeration + 150;
      const world = Cesium.Cartesian3.fromDegrees(item.lon, item.lat, lifted);
      const screen = this.scene.mode === Cesium.SceneMode.SCENE3D && !occluder.isPointVisible(world)
        ? undefined
        : this.toWindow(this.scene, world);
      // Seen means clear of the screen's edges and of the chrome by a margin:
      // the sliver above the top bar does not count as map.
      const seen = screen && screen.x >= EDGE && screen.y >= EDGE && screen.x <= width - EDGE && screen.y <= height - EDGE
        && !chrome.some((r) => screen.x >= r.x - EDGE && screen.x <= r.x + r.w + EDGE && screen.y >= r.y - EDGE && screen.y <= r.y + r.h + EDGE);
      if (seen) points.set(name, { x: screen.x, y: screen.y });
    }

    // ---- places ----
    const now = performance.now();
    for (const [name, item] of this.items) {
      if (!points.has(name)) {
        item.offset = null; // placed afresh when it comes back into view
        item.tween = null;
      }
    }
    const current = (item) => {
      if (!item.tween) return item.offset;
      const t = Math.min((now - item.tween.start) / SETTLE_MS, 1);
      const e = easeOut(t);
      const { from, to } = item.tween;
      return { dx: from.dx + (to.dx - from.dx) * e, dy: from.dy + (to.dy - from.dy) * e };
    };
    if (this.dirty) {
      this.dirty = false;
      const places = this.solve([...points.keys()], points, chrome, width, height);
      for (const [name, place] of places) {
        const item = this.items.get(name);
        const from = current(item);
        item.spot = place.spot;
        item.offset = { dx: place.dx, dy: place.dy };
        // Already on screen: glide there. New on screen: just appear there.
        item.tween = from && Math.hypot(from.dx - place.dx, from.dy - place.dy) > 1 ? { from, to: item.offset, start: now } : null;
      }
    } else {
      // Counties that came into view while the camera moved get a free place,
      // leaving everyone else where they are.
      const fresh = [...points.keys()].filter((name) => !this.items.get(name).offset);
      if (fresh.length) {
        const taken = [...chrome];
        for (const [name, point] of points) {
          const item = this.items.get(name);
          const offset = item.offset && current(item);
          if (offset) taken.push({ x: point.x + offset.dx, y: point.y + offset.dy, w: item.size.w, h: item.size.h });
        }
        for (const [name, place] of this.solve(fresh, points, taken, width, height)) {
          const item = this.items.get(name);
          item.spot = place.spot;
          item.offset = { dx: place.dx, dy: place.dy };
        }
      }
    }

    // ---- writes ----
    let gliding = false;
    for (const [name, item] of this.items) {
      const point = points.get(name);
      const tucked = !point;
      if (item.tucked !== tucked) {
        item.tucked = tucked;
        item.element.classList.toggle("tucked", tucked);
      }
      if (tucked) {
        this.showLeader(item, false);
        continue;
      }
      const offset = current(item);
      if (item.tween && now - item.tween.start >= SETTLE_MS) item.tween = null;
      else if (item.tween) gliding = true;
      const { w, h } = item.size;
      const box = { x: point.x + offset.dx, y: point.y + offset.dy, w, h };
      const transform = `translate(${box.x.toFixed(1)}px, ${box.y.toFixed(1)}px)`;
      if (item.transform !== transform) {
        item.transform = transform;
        item.element.style.transform = transform;
      }
      // A leader whenever the bubble is not sitting just above its county.
      const away = Math.hypot(offset.dx + w / 2, offset.dy + h + LIFT) > 3;
      this.showLeader(item, away);
      if (away) {
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
    // The scene renders on demand; keep frames coming while bubbles glide.
    if (gliding) requestAnimationFrame(() => this.scene.requestRender());
  }

  showLeader(item, shown) {
    if (Boolean(item.leaderShown) === shown) return;
    item.leaderShown = shown;
    item.leader.style.display = shown ? "" : "none";
  }
}
