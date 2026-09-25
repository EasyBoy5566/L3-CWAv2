// The wind field: particles carried by Open-Meteo's 10 m wind, drawn on a
// canvas laid over the globe. Cesium renders on demand; this canvas runs its
// own frame loop and projects every particle each frame, so it follows the
// camera without asking the globe to redraw.
/* global Cesium */

// Speed bands in m/s and their colours: calm is pale, 6 級 (10.8) turns
// yellow, 8 級 (17.2) red. The legend in the controls card draws the same.
const BANDS = [
  [2, "#bae6fd"],
  [4, "#7dd3fc"],
  [6, "#5eead4"],
  [8, "#a3e635"],
  [10.8, "#facc15"],
  [13.9, "#fb923c"],
  [17.2, "#f87171"],
  [Infinity, "#e879f9"],
];
const FADE = 0.92; // how much of the last frame's trails each frame keeps
const SPEED = 1.6e-4; // degrees per frame per m/s, per degree of view width
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const band = (speed) => BANDS.findIndex(([limit]) => speed < limit);

export class WindField {
  constructor(viewer, field) {
    this.viewer = viewer;
    this.field = field;
    const { lon0, lat0, step, nx, ny } = field.grid;
    this.bounds = { west: lon0, south: lat0, east: lon0 + step * (nx - 1), north: lat0 + step * (ny - 1) };
    this.canvas = document.createElement("canvas");
    this.canvas.className = "wind-canvas";
    viewer.cesiumWidget.container.appendChild(this.canvas);
    this.context = this.canvas.getContext("2d");
    this.particles = [];
    this.segments = BANDS.map(() => []);
    this.world = new Cesium.Cartesian3();
    this.screen = new Cesium.Cartesian2();
    this.rectangle = new Cesium.Rectangle();
    this.lastView = new Cesium.Matrix4();
    this.occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, viewer.camera.positionWC);
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

  resize() {
    const { clientWidth: width, clientHeight: height } = this.viewer.scene.canvas;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.width = width;
    this.height = height;
    // More screen, more particles; a phone gets about 700, a desktop 2,500.
    const count = Math.round(Math.min(2500, Math.max(600, (width * height) / 800)));
    this.particles = Array.from({ length: count }, () => ({ lon: 0, lat: 0, age: 0, life: 0, x: null, y: null }));
    this.area = null; // re-read the view before spawning
  }

  /** The wind at a point as [u, v] m/s, bilinear between grid points; null outside or where missing. */
  sample(lon, lat) {
    const { lon0, lat0, step, nx, ny } = this.field.grid;
    const fx = (lon - lon0) / step;
    const fy = (lat - lat0) / step;
    if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return null;
    const i = Math.min(Math.floor(fx), nx - 2);
    const j = Math.min(Math.floor(fy), ny - 2);
    const tx = fx - i;
    const ty = fy - j;
    const at = (values, di, dj) => values[(j + dj) * nx + i + di];
    const mix = (values) => {
      const corners = [at(values, 0, 0), at(values, 1, 0), at(values, 0, 1), at(values, 1, 1)];
      if (corners.some((c) => c === null)) return null;
      const [a, b, c, d] = corners;
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    };
    const u = mix(this.field.u);
    const v = mix(this.field.v);
    return u === null || v === null ? null : [u, v];
  }

  // Where particles are born: the part of the grid the camera sees, and how
  // wide the view is, which sets how far a particle moves per frame.
  readView() {
    const { camera } = this.viewer;
    const view = camera.computeViewRectangle(Cesium.Ellipsoid.WGS84, this.rectangle);
    const b = this.bounds;
    let west = b.west, east = b.east, south = b.south, north = b.north, span = east - west;
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

  // Move each particle one step and queue the segment it drew, by colour.
  advance(dt, draw) {
    const step = SPEED * this.span * dt;
    for (const segments of this.segments) segments.length = 0;
    for (const p of this.particles) {
      if (p.age === 0 && p.life === 0) this.spawn(p);
      const wind = this.sample(p.lon, p.lat);
      if (!wind || ++p.age > p.life) {
        this.spawn(p);
        continue;
      }
      const [u, v] = wind;
      p.lon += (u * step) / Math.cos((p.lat * Math.PI) / 180);
      p.lat += v * step;
      const screen = this.project(p.lon, p.lat);
      if (!screen) {
        p.x = p.y = null;
        continue;
      }
      if (draw && p.x !== null) this.segments[band(Math.hypot(u, v))].push(p.x, p.y, screen.x, screen.y);
      p.x = screen.x;
      p.y = screen.y;
    }
  }

  stroke() {
    const { context } = this;
    context.lineWidth = 1.4;
    context.lineCap = "round";
    this.segments.forEach((segments, index) => {
      if (!segments.length) return;
      context.beginPath();
      for (let k = 0; k < segments.length; k += 4) {
        context.moveTo(segments[k], segments[k + 1]);
        context.lineTo(segments[k + 2], segments[k + 3]);
      }
      context.strokeStyle = BANDS[index][1];
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
    const moved = !Cesium.Matrix4.equals(camera.viewMatrix, this.lastView);
    const { context } = this;
    if (moved || !this.area) {
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
          this.advance(1, true);
          this.stroke();
        }
        return;
      }
    }
    if (reducedMotion.matches) return;
    const dt = this.last ? Math.min((time - this.last) / 16.7, 3) : 1;
    this.last = time;
    context.globalCompositeOperation = "destination-in";
    context.fillStyle = `rgba(0, 0, 0, ${FADE})`;
    context.fillRect(0, 0, this.width, this.height);
    context.globalCompositeOperation = "source-over";
    this.advance(dt, true);
    this.stroke();
  }
}
