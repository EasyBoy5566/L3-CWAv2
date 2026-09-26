// The wind field: particles carried by Open-Meteo's 10 m wind, drawn on a
// canvas laid over the globe. Cesium renders on demand; this canvas runs its
// own frame loop and projects every particle each frame, so it follows the
// camera without asking the globe to redraw.
//
// Each particle keeps its last few places and the canvas is drawn afresh
// every frame, its trail fading from head to tail. (Fading the whole canvas
// a little each frame instead leaves a haze: 8-bit alpha rounds the faintest
// trails to a value that never reaches zero.)
//
// Two grids: a coarse one across the seas and a fine one over Taiwan, blended
// where they meet. The field fades out towards the coarse grid's edge, so it
// has no border to see, and calm wind is drawn faint so strong wind leads.
/* global Cesium */
import { WIND, bandOf } from "./scale.js";

// How much each band stands out, from calm (0) to 6 級 and up (1).
const BAND_RAMP = [0, 0.15, 0.35, 0.5, 0.7, 0.85, 1, 1];
// By day the imagery is busy and every line needs its strength; at night the
// map is dark and bright lines glare, so calm wind is drawn fainter and
// strong wind leads, but every line still reads. A band's opacity is
// alpha × (floor + (1 − floor) × ramp). `trail` is how many places a
// particle's line runs back over.
const SKY = {
  day: { alpha: 1, floor: 0.55, width: 1.5, trail: 40 },
  dusk: { alpha: 0.9, floor: 0.45, width: 1.4, trail: 40 },
  night: { alpha: 0.85, floor: 0.4, width: 1.3, trail: 40 },
};
// A trail in four parts, head to tail, each fainter than the one before.
const AGE_ALPHA = [1, 0.75, 0.5, 0.25];
// When the camera moves, this many of a trail's places are projected again;
// the rest grow back as the particle moves on.
const KEEP_ON_MOVE = 3;
const EDGE_FADE = 4; // degrees over which the field fades out at its edge
const BLEND = 1; // degrees over which the fine grid gives way to the coarse
const LEVELS = 3; // steps of the edge fade, each drawn as its own path
const SPEED = 1.6e-4; // degrees per frame per m/s, per degree of view width
// Closer in than this the half-degree grid says nothing about the streets
// below, and the city's 3D buildings need every frame: the field rests.
const REST_BELOW = 25000;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const rgba = (hex, alpha) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")}, ${alpha})`;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Degrees from a point to a grid's nearest edge; negative outside it.
function inset(grid, lon, lat) {
  const east = grid.lon0 + grid.step * (grid.nx - 1);
  const north = grid.lat0 + grid.step * (grid.ny - 1);
  return Math.min(lon - grid.lon0, east - lon, lat - grid.lat0, north - lat);
}

// A grid's wind at a point as [u, v] m/s, bilinear between its points; null outside or where missing.
function sampleGrid(grid, lon, lat) {
  const { lon0, lat0, step, nx, ny, u, v } = grid;
  const fx = (lon - lon0) / step;
  const fy = (lat - lat0) / step;
  if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return null;
  const i = Math.min(Math.floor(fx), nx - 2);
  const j = Math.min(Math.floor(fy), ny - 2);
  const tx = fx - i;
  const ty = fy - j;
  const k = j * nx + i;
  const mix = (values) => {
    const a = values[k], b = values[k + 1], c = values[k + nx], d = values[k + nx + 1];
    if (a === null || b === null || c === null || d === null) return null;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  const x = mix(u);
  const y = mix(v);
  return x === null || y === null ? null : [x, y];
}

const forget = (p) => {
  p.lons.length = p.lats.length = p.xs.length = p.ys.length = 0;
};

export class WindField {
  constructor(viewer, field, sky = "night") {
    this.viewer = viewer;
    this.grids = field.grids; // coarse first
    const outer = this.grids[0];
    this.bounds = {
      west: outer.lon0, south: outer.lat0,
      east: outer.lon0 + outer.step * (outer.nx - 1), north: outer.lat0 + outer.step * (outer.ny - 1),
    };
    this.canvas = document.createElement("canvas");
    this.canvas.className = "wind-canvas";
    viewer.cesiumWidget.container.appendChild(this.canvas);
    this.context = this.canvas.getContext("2d");
    this.particles = [];
    this.paths = Array.from({ length: WIND.bands.length * LEVELS * AGE_ALPHA.length }, () => []);
    this.world = new Cesium.Cartesian3();
    this.screen = new Cesium.Cartesian2();
    this.rectangle = new Cesium.Rectangle();
    this.lastView = new Cesium.Matrix4();
    this.occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, viewer.camera.positionWC);
    this.setSky(sky);
    this.frame = this.frame.bind(this);
    this.resize = this.resize.bind(this);
    window.addEventListener("resize", this.resize);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.canvas.remove();
  }

  /** "day", "dusk" or "night" (see glass.js setSky). */
  setSky(sky) {
    this.sky = SKY[sky] ?? SKY.night;
    const { alpha, floor } = this.sky;
    // One style per band, edge level and part of the trail, in that order.
    this.styles = WIND.bands.flatMap(([, hex], band) => Array.from({ length: LEVELS }, (_, level) =>
      AGE_ALPHA.map((age) => rgba(hex, +(alpha * (floor + (1 - floor) * BAND_RAMP[band]) * ((level + 1) / LEVELS) * age).toFixed(3)))).flat());
    this.area = null; // redraw from clean
  }

  resize() {
    const { clientWidth: width, clientHeight: height } = this.viewer.scene.canvas;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.width = width;
    this.height = height;
    // More screen, more particles; a phone gets about 600, a desktop 2,200.
    const count = Math.round(Math.min(2200, Math.max(600, (width * height) / 900)));
    this.particles = Array.from({ length: count }, () => ({ life: 0, lons: [], lats: [], xs: [], ys: [], path: -1 }));
    this.area = null; // re-read the view before spawning
  }

  /** The wind at a point: [u, v, strength 0–1 by the distance from the edge], or null outside. */
  sample(lon, lat) {
    const [outer, inner] = this.grids;
    let wind = sampleGrid(outer, lon, lat);
    if (!wind) return null;
    const near = inner ? inset(inner, lon, lat) : -1;
    const fine = near > 0 ? sampleGrid(inner, lon, lat) : null;
    if (fine) {
      const w = clamp01(near / BLEND);
      wind = [wind[0] * (1 - w) + fine[0] * w, wind[1] * (1 - w) + fine[1] * w];
    }
    return [wind[0], wind[1], clamp01(inset(outer, lon, lat) / EDGE_FADE)];
  }

  // Where particles are born: the part of the field the camera sees, and how
  // wide the view is, which sets how far a particle moves per frame.
  readView() {
    const view = this.viewer.camera.computeViewRectangle(Cesium.Ellipsoid.WGS84, this.rectangle);
    const b = this.bounds;
    let { west, east, south, north } = b;
    let span = east - west;
    if (view && view.east > view.west) {
      const d = Cesium.Math.toDegrees;
      west = Math.max(west, d(view.west));
      east = Math.min(east, d(view.east));
      south = Math.max(south, d(view.south));
      north = Math.min(north, d(view.north));
      span = Math.min(d(view.east - view.west), 30);
    }
    this.area = east > west && north > south ? { west, east, south, north } : null;
    this.span = Math.max(span, 0.05);
  }

  spawn(p) {
    const a = this.area;
    p.lon = a.west + Math.random() * (a.east - a.west);
    p.lat = a.south + Math.random() * (a.north - a.south);
    p.age = 0;
    p.life = 60 + Math.random() * 80; // long enough for the trail to reach its length
    forget(p);
  }

  // A place on screen, or null behind the globe or off the canvas.
  project(lon, lat) {
    const { scene } = this.viewer;
    const world = Cesium.Cartesian3.fromDegrees(lon, lat, 0, Cesium.Ellipsoid.WGS84, this.world);
    if (scene.mode === Cesium.SceneMode.SCENE3D && !this.occluder.isPointVisible(world)) return null;
    const screen = Cesium.SceneTransforms.worldToWindowCoordinates(scene, world, this.screen);
    if (!screen || screen.x < -20 || screen.y < -20 || screen.x > this.width + 20 || screen.y > this.height + 20) return null;
    return screen;
  }

  // The camera moved: each trail keeps its newest few places, projected anew.
  reproject() {
    for (const p of this.particles) {
      const keep = Math.min(KEEP_ON_MOVE, p.lons.length);
      const lons = p.lons.slice(-keep);
      const lats = p.lats.slice(-keep);
      forget(p);
      for (let k = 0; k < keep; k++) {
        const screen = this.project(lons[k], lats[k]);
        if (!screen) {
          forget(p);
          continue;
        }
        p.lons.push(lons[k]);
        p.lats.push(lats[k]);
        p.xs.push(screen.x);
        p.ys.push(screen.y);
      }
    }
  }

  // Move each particle one step and add its new place to its trail.
  advance(dt) {
    const step = SPEED * this.span * dt;
    const length = this.sky.trail;
    for (const p of this.particles) {
      if (p.life === 0) this.spawn(p);
      const wind = this.sample(p.lon, p.lat);
      if (!wind || ++p.age > p.life) {
        this.spawn(p);
        continue;
      }
      const [u, v, strength] = wind;
      p.lon += (u * step) / Math.cos((p.lat * Math.PI) / 180);
      p.lat += v * step;
      const screen = this.project(p.lon, p.lat);
      if (!screen) {
        forget(p);
        continue;
      }
      p.lons.push(p.lon);
      p.lats.push(p.lat);
      p.xs.push(screen.x);
      p.ys.push(screen.y);
      if (p.xs.length > length) {
        p.lons.shift();
        p.lats.shift();
        p.xs.shift();
        p.ys.shift();
      }
      // The whole trail takes the colour of the wind where the particle is now.
      const level = Math.ceil(strength * LEVELS) - 1;
      p.path = level < 0 ? -1 : (WIND.bands.indexOf(bandOf(WIND, Math.hypot(u, v))) * LEVELS + level) * AGE_ALPHA.length;
    }
  }

  draw() {
    const { context } = this;
    context.clearRect(0, 0, this.width, this.height);
    for (const path of this.paths) path.length = 0;
    const ages = AGE_ALPHA.length;
    for (const p of this.particles) {
      const n = p.xs.length;
      if (n < 2 || p.path < 0) continue;
      for (let i = 1; i < n; i++) {
        // The newest segment in the first part, the oldest in the last.
        const age = Math.min(ages - 1, Math.floor(((n - 1 - i) / (n - 1)) * ages));
        this.paths[p.path + age].push(p.xs[i - 1], p.ys[i - 1], p.xs[i], p.ys[i]);
      }
    }
    context.lineWidth = this.sky.width;
    context.lineCap = "round";
    this.paths.forEach((path, index) => {
      if (!path.length) return;
      context.beginPath();
      for (let k = 0; k < path.length; k += 4) {
        context.moveTo(path[k], path[k + 1]);
        context.lineTo(path[k + 2], path[k + 3]);
      }
      context.strokeStyle = this.styles[index];
      context.stroke();
    });
  }

  frame(time) {
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) {
      this.last = null;
      return;
    }
    const { camera, scene } = this.viewer;
    // Resting: close in, or the Google 3D buildings are up (they hide the globe).
    if (!scene.globe.show || camera.positionCartographic.height < REST_BELOW) {
      if (!this.resting) {
        this.resting = true;
        this.context.clearRect(0, 0, this.width, this.height);
      }
      this.last = null;
      return;
    }
    if (this.resting) {
      this.resting = false;
      this.area = null; // start over from the view at hand
    }
    const fresh = !this.area;
    const moved = fresh || !Cesium.Matrix4.equals(camera.viewMatrix, this.lastView);
    if (moved) {
      Cesium.Matrix4.clone(camera.viewMatrix, this.lastView);
      this.occluder.cameraPosition = camera.positionWC;
      this.readView();
      if (!this.area) {
        this.context.clearRect(0, 0, this.width, this.height);
        return;
      }
      if (fresh) {
        // Starting over (after a rest, a new sky or size): every particle is born anew.
        for (const p of this.particles) p.life = 0;
      } else {
        this.reproject();
      }
    }
    // Nothing is animated for those who asked for less motion: the trails
    // are traced once for each view instead.
    if (reducedMotion.matches) {
      if (!moved) return;
      for (const p of this.particles) this.spawn(p);
      for (let k = 0; k < this.sky.trail; k++) this.advance(1);
      this.draw();
      return;
    }
    const dt = this.last ? Math.min((time - this.last) / 16.7, 3) : 1;
    this.last = time;
    this.advance(dt);
    this.draw();
  }
}
