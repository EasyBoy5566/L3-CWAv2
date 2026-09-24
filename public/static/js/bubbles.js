// Glass value bubbles floating over each county.
//
// They are HTML, not Cesium labels. After every frame each county's label
// point (see scripts/build_geo.py, lifted by the exaggerated terrain height)
// is projected to the screen, and every county whose point can be seen gets
// its bubble: one off screen, or under the floating chrome, gets none.
//
// A bubble sits centred on its county. Where that is taken, nearest the
// island's spine first, it takes the first free place, clear of the bubbles
// already placed, the other counties' points and the floating chrome: nudged
// a little; else just beside its county; else out to sea, away from the spine
// (Fugui Cape to Eluanbi), so west-coast counties go west, east-coast ones
// east and the crowded north fans out from the northern tip. A bubble that no
// longer covers its county's point is tied to it by a hairline ending in a dot.
//
// Places are worked out every frame, but without flicker: a bubble keeps the
// place it has for as long as that stays free; when it is taken, moves to the
// free place nearest where it is, not to the best one far away; returns to a
// better place only when there is clear room for it; and glides every move.
/* global Cesium */
import { escapeHtml } from "./format.js";
import { colorAt } from "./scale.js";

const FAR = 260000; // camera height in metres above which names are shortened
const GAP = 4;
// Floating chrome that bubbles must not slide underneath.
const OBSTACLES = ".topbar, .controls, .panel:not([hidden]), .typhoon-card:not([hidden])";
const SVG_NS = "http://www.w3.org/2000/svg";
// How far inside the map (clear of edges and panels) a county's point must be for its bubble to show.
const EDGE = 12;
// Extra room a better place must have before a bubble moves back to it, so
// one on the edge of fitting does not flip between the two.
const HYSTERESIS = 14;
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
// How quickly a bubble glides to a new place: the gap left after t ms is e^(-t / GLIDE_MS).
const GLIDE_MS = 110;

function shortNames(names) {
  const stems = names.map((name) => name.replace(/[市縣]$/, ""));
  return new Map(names.map((name, i) => [name, stems.filter((s) => s === stems[i]).length > 1 ? name : stems[i]]));
}

const overlaps = (a, b, gap = GAP) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

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
    this.lastFrame = 0;
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
    // Placing order, nearest the spine first. Measured on the ground, not on
    // screen, so it never changes as the camera moves and cannot set off a
    // chain of re-placements.
    const [a, b] = SPINE;
    const k = Math.cos((23.7 * Math.PI) / 180);
    const spineKm = ({ lon, lat }) => {
      const ax = (b.lon - a.lon) * k;
      const ay = b.lat - a.lat;
      const px = (lon - a.lon) * k;
      const py = lat - a.lat;
      const t = Math.min(Math.max((px * ax + py * ay) / (ax * ax + ay * ay), 0), 1);
      return Math.hypot(px - ax * t, py - ay * t) * 111;
    };
    this.order = [...this.items.keys()].sort((x, y) => spineKm(this.items.get(x)) - spineKm(this.items.get(y)));
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

  // Each seen county's place this frame, as the offset of its box from its
  // point. See the comment at the top.
  solve(points, chrome, width, height) {
    const marks = [...points.values()].map((p) => ({ x: p.x - 3, y: p.y - 3, w: 6, h: 6 }));
    const [tipA, tipB] = SPINE.map(({ lon, lat }) => this.toWindow(this.scene, Cesium.Cartesian3.fromDegrees(lon, lat, 0)));
    // Away from the nearest point of the spine; a county on the spine itself
    // (Nantou) goes to the side of the spine with the open east coast.
    const fromSpine = (point) => {
      if (!tipA || !tipB) return -Math.PI / 2;
      const ax = tipB.x - tipA.x;
      const ay = tipB.y - tipA.y;
      const t = Math.min(Math.max(((point.x - tipA.x) * ax + (point.y - tipA.y) * ay) / (ax * ax + ay * ay || 1), 0), 1);
      const dx = point.x - (tipA.x + ax * t);
      const dy = point.y - (tipA.y + ay * t);
      if (Math.hypot(dx, dy) > 12) return Math.atan2(dy, dx);
      // Perpendicular to the spine, towards the east (screen right when north is up).
      const side = Math.atan2(ax, -ay);
      return Math.cos(side) >= 0 ? side : side + Math.PI;
    };
    const order = this.order.filter((name) => points.has(name))
      .sort((a, b) => (b === this.selected) - (a === this.selected));

    const placed = [...chrome];
    const result = new Map();
    for (const name of order) {
      const item = this.items.get(name);
      const point = points.get(name);
      const { w, h } = item.size;
      const others = marks.filter((m) => Math.abs(m.x + 3 - point.x) > 0.5 || Math.abs(m.y + 3 - point.y) > 0.5);
      const fits = (box, gap = GAP) => box.x >= 0 && box.y >= 0 && box.x + box.w <= width && box.y + box.h <= height
        && !placed.some((p) => overlaps(box, p, gap)) && !others.some((m) => overlaps(box, m, gap));
      // Places, best first, as the box's centre relative to the county's point:
      // on it; nudged, still over it; just beside it; then out to sea.
      const outward = fromSpine(point);
      const candidates = [
        ["on", 0, 0],
        ["up", 0, -h * 0.4], ["down", 0, h * 0.4], ["east", w * 0.3, 0], ["west", -w * 0.3, 0],
        ["above", 0, -(h / 2 + 8)], ["below", 0, h / 2 + 8], ["right", w / 2 + 8, 0], ["left", -(w / 2 + 8), 0],
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

      // A bubble with no place yet takes the best free one. One with a place
      // keeps it while it stays free, unless a better one has clear room;
      // when its place is taken it moves to the free place nearest where it
      // is. With nowhere free it sits on its county, overlapping, but shown.
      const rank = new Map(candidates.map((c, i) => [c[0], i]));
      const current = item.spot !== null && rank.has(item.spot) ? candidates[rank.get(item.spot)] : null;
      let choice;
      if (!current) {
        choice = candidates.find((c) => fits(boxOf(c)));
      } else {
        choice = candidates.slice(0, rank.get(current[0])).find((c) => fits(boxOf(c), GAP + HYSTERESIS));
        if (!choice && fits(boxOf(current))) choice = current;
        if (!choice) {
          const here = item.offset ?? { dx: current[1] - w / 2, dy: current[2] - h / 2 };
          let nearest = Infinity;
          for (const c of candidates) {
            const box = boxOf(c);
            const moved = Math.hypot(box.x - point.x - here.dx, box.y - point.y - here.dy);
            if (moved < nearest && fits(box)) {
              nearest = moved;
              choice = c;
            }
          }
        }
      }
      choice ??= candidates[0];
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
    const dt = Math.min(now - (this.lastFrame || now), 100);
    this.lastFrame = now;
    // Share of the way to its new place a bubble moves this frame.
    const step = 1 - Math.exp(-dt / GLIDE_MS);
    const places = this.solve(points, chrome, width, height);
    let gliding = false;
    for (const [name, item] of this.items) {
      const place = places.get(name);
      if (!place) {
        item.offset = null; // appears at its place when it comes back into view
        item.spot = null;
        continue;
      }
      item.spot = place.spot;
      if (!item.offset) {
        item.offset = { dx: place.dx, dy: place.dy };
        continue;
      }
      const gap = Math.hypot(place.dx - item.offset.dx, place.dy - item.offset.dy);
      if (gap < 0.5) {
        item.offset = { dx: place.dx, dy: place.dy };
      } else {
        item.offset = { dx: item.offset.dx + (place.dx - item.offset.dx) * step, dy: item.offset.dy + (place.dy - item.offset.dy) * step };
        gliding = true;
      }
    }

    // ---- writes ----
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
      const { w, h } = item.size;
      const box = { x: point.x + item.offset.dx, y: point.y + item.offset.dy, w, h };
      const transform = `translate(${box.x.toFixed(1)}px, ${box.y.toFixed(1)}px)`;
      if (item.transform !== transform) {
        item.transform = transform;
        item.element.style.transform = transform;
      }
      // A leader once the bubble no longer covers its county's point.
      const ex = Math.min(Math.max(point.x, box.x + 10), box.x + box.w - 10);
      const ey = Math.min(Math.max(point.y, box.y), box.y + box.h);
      const away = Math.hypot(point.x - Math.min(Math.max(point.x, box.x), box.x + box.w), point.y - Math.min(Math.max(point.y, box.y), box.y + box.h)) > 4;
      this.showLeader(item, away);
      if (away) {
        // From the point on the bubble's edge nearest the county to the county.
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
