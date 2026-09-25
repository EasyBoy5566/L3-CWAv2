// The wind field: particles carried by Open-Meteo's 10 m wind, drawn on a
// canvas laid over the globe. Cesium renders on demand; this canvas runs its
// own frame loop and projects every particle each frame, so it follows the
// camera without asking the globe to redraw.
//
// Two grids: a coarse one across the seas and a fine one over Taiwan, blended
// where they meet. The field fades out towards the coarse grid's edge, so it
// has no border to see, and calm wind is drawn faint so strong wind leads.
/* global Cesium */
import { WIND, bandOf } from "./scale.js";

// How much each band stands out, from calm (0) to 6 級 and up (1).
const BAND_RAMP = [0, 0.15, 0.35, 0.5, 0.7, 0.85, 1, 1];
// By day the imagery is busy and every line needs its strength; at night the
// map is dark and bright lines glare, so calm wind all but disappears and
// only strong wind is drawn near full. A band's opacity is
// alpha × (floor + (1 − floor) × ramp).
const SKY = {
  day: { alpha: 1, floor: 0.55, width: 1.5, fade: 0.93 },
  dusk: { alpha: 0.85, floor: 0.35, width: 1.3, fade: 0.92 },
  night: { alpha: 0.65, floor: 0.2, width: 1.1, fade: 0.9 },
};
const EDGE_FADE = 4; // degrees over which the field fades out at its edge
const BLEND = 1; // degrees over which the fine grid gives way to the coarse
const LEVELS = 3; // steps of the edge fade, each drawn as its own path
const SPEED = 1.6e-4; // degrees per frame per m/s, per degree of view width
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
    this.paths = WIND.bands.flatMap(() => Array.from({ length: LEVELS }, () => []));
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
    this.styles = WIND.bands.flatMap(([, hex], band) => Array.from({ length: LEVELS },
      (_, level) => {
        const { alpha, floor } = this.sky;
        return rgba(hex, +(alpha * (floor + (1 - floor) * BAND_RAMP[band]) * ((level + 1) / LEVELS)).toFixed(3));
      }));
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
    this.particles = Array.from({ length: count }, () => ({ lon: 0, lat: 0, age: 0, life: 0, x: null, y: null }));
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
    p.life = 40 + Math.random() * 60;
    p.x = p.y = null;
  }

  // The particle's place on screen, or null behind the globe or off the canvas.
  project(lon, lat) {
    const { scene } = this.viewer;
    const world = Cesium.Cartesian3.fromDegrees(lon, lat, 0, Cesium.Ellipsoid.WGS84, this.world);
    if (scene.mode === Cesium.SceneMode.SCENE3D && !this.occluder.isPointVisible(world)) return null;
    const screen = Cesium.SceneTransforms.worldToWindowCoordinates(scene, world, this.screen);
    if (!screen || screen.x < -20 || screen.y < -20 || screen.x > this.width + 20 || screen.y > this.height + 20) return null;
    return screen;
  }

  // Move each particle one step and queue the segment it drew by colour and strength.
  advance(dt) {
    const step = SPEED * this.span * dt;
    for (const path of this.paths) path.length = 0;
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
        p.x = p.y = null;
        continue;
      }
      const level = Math.ceil(strength * LEVELS) - 1;
      if (p.x !== null && level >= 0) {
        const band = WIND.bands.indexOf(bandOf(WIND, Math.hypot(u, v)));
        this.paths[band * LEVELS + level].push(p.x, p.y, screen.x, screen.y);
      }
      p.x = screen.x;
      p.y = screen.y;
    }
  }

  stroke() {
    const { context } = this;
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
    const { camera } = this.viewer;
    const { context } = this;
    if (!Cesium.Matrix4.equals(camera.viewMatrix, this.lastView) || !this.area) {
      Cesium.Matrix4.clone(camera.viewMatrix, this.lastView);
      this.occluder.cameraPosition = camera.positionWC;
      this.readView();
      context.clearRect(0, 0, this.width, this.height);
      for (const p of this.particles) p.x = p.y = null;
      if (!this.area) return;
      // Nothing is animated for those who asked for less motion: short
      // streaks are traced once for each view instead.
      if (reducedMotion.matches) {
        for (const p of this.particles) this.spawn(p);
        for (let k = 0; k < 12; k++) {
          this.advance(1);
          this.stroke();
        }
        return;
      }
    }
    if (reducedMotion.matches) return;
    const dt = this.last ? Math.min((time - this.last) / 16.7, 3) : 1;
    this.last = time;
    context.globalCompositeOperation = "destination-in";
    context.fillStyle = `rgba(0, 0, 0, ${this.sky.fade})`;
    context.fillRect(0, 0, this.width, this.height);
    context.globalCompositeOperation = "source-over";
    this.advance(dt);
    this.stroke();
  }
}
