// The 3D Taiwan: terrain, the sun and moon at their real positions, county
// borders draped as imagery, and glass value bubbles.
/* global Cesium */
import { Bubbles } from "./bubbles.js";
import { BOUNDS, bordersCanvas, countyAt, highlightCanvas, loadCounties, loadTowns, townAt, townBordersCanvas } from "./geo.js";
import { Overlays } from "./overlays.js";

// The camera aims south of the island's centre so Taiwan sits above the dock.
const HOME = { lon: 120.95, lat: 23.15, heading: -12, pitch: -42, range: 600000 };
// What the 2D map frames: the main island with Penghu, Kinmen and Matsu, and
// extra sea to the south so the dock does not cover the southern tip.
const TAIWAN_2D = [117.9, 21.0, 122.6, 26.5];
const EXAGGERATION = 2.5;
// Terrain is exaggerated from afar so the Central Range reads, and eases back
// to true scale near the ground so buildings and streets sit right.
const TRUE_SCALE_BELOW = 20000;
const FULL_SCALE_ABOVE = 150000;

// Where the shadow simulation takes the camera: tall buildings, clear shadows.
export const SHADOW_CITIES = {
  taipei: { label: "臺北 101", lon: 121.5645, lat: 25.0339, heading: 205, pitch: -24, range: 2400 },
  kaohsiung: { label: "高雄 85 大樓", lon: 120.3006, lat: 22.6116, heading: 160, pitch: -24, range: 2200 },
  taichung: { label: "臺中 七期", lon: 120.6440, lat: 24.1630, heading: 200, pitch: -26, range: 2400 },
};

// Bubble anchors inside each county, spread so the crowded north and the
// county/city pairs (Hsinchu, Chiayi) do not stack at the default view.
// Counties not listed use CWA's representative point.
const LABEL_POINTS = {
  基隆市: [25.13, 121.74],
  臺北市: [25.09, 121.56],
  新北市: [24.86, 121.72],
  桃園市: [24.86, 121.24],
  新竹市: [24.80, 120.94],
  新竹縣: [24.66, 121.18],
  苗栗縣: [24.49, 120.93],
  臺中市: [24.24, 120.92],
  彰化縣: [23.98, 120.47],
  南投縣: [23.84, 120.98],
  嘉義縣: [23.33, 120.72],
  高雄市: [22.98, 120.56],
  屏東縣: [22.55, 120.62],
  花蓮縣: [23.75, 121.42],
  臺東縣: [22.95, 121.08],
};

// Imagery is lit with the globe, so draped overlays darken at night; these
// brightness factors keep them readable after dark.
const OVERLAY_BRIGHTNESS = { day: 1, dusk: 1.4, night: 1.8 };
// The selection outline must glow at any hour, so it is lifted further.
const HIGHLIGHT_BRIGHTNESS = { day: 1.2, dusk: 2.2, night: 3.4 };
// Above this camera height the coarse border raster is shown; below, the fine one.
const BORDER_SWITCH = 300000;
// Below this camera height townships are drawn, hovered and picked; above it, counties.
const TOWN_LEVEL = 350000;

function imagery(token) {
  if (token) return undefined; // Cesium ion default imagery
  // Without an ion token: Esri World Imagery, which needs no key.
  return Cesium.ImageryLayer.fromProviderAsync(
    Cesium.ArcGisMapServerImageryProvider.fromUrl("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"),
  );
}

async function canvasLayer(viewer, canvas, bounds, index) {
  const provider = await Cesium.SingleTileImageryProvider.fromUrl(canvas.toDataURL("image/png"), {
    rectangle: Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north),
  });
  return viewer.imageryLayers.addImageryProvider(provider, index);
}

export async function createGlobe(element, { token, counties: countyList, onHover, onInfo, onSelect }) {
  if (token) Cesium.Ion.defaultAccessToken = token;
  const terrain = token ? Cesium.Terrain.fromWorldTerrain({ requestVertexNormals: true }) : undefined;
  const options = {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: true,
    // Render only when something changes; the sun moves slowly enough that a
    // frame per simulated minute keeps it smooth.
    requestRenderMode: true,
    maximumRenderTimeChange: 60,
  };
  const baseLayer = imagery(token);
  if (baseLayer) options.baseLayer = baseLayer;
  if (terrain) options.terrain = terrain;

  const viewer = new Cesium.Viewer(element, options);
  const { scene } = viewer;
  const exaggeration = token ? EXAGGERATION : 1;
  scene.verticalExaggeration = exaggeration;
  scene.globe.enableLighting = true;
  scene.globe.dynamicAtmosphereLighting = true;
  scene.globe.dynamicAtmosphereLightingFromSun = true;
  scene.moon.show = true;
  scene.sun.show = true;
  viewer.shadowMap.softShadows = true;
  viewer.shadowMap.size = 2048;
  viewer.creditDisplay.addStaticCredit(new Cesium.Credit("資料：中央氣象署開放資料 · 縣市界：內政部國土測繪中心", false));
  viewer.clock.currentTime = Cesium.JulianDate.now();
  viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK;

  // ---------- county geometry, borders and highlights ----------
  const counties = await loadCounties();
  // A single image has no mipmaps, so one border raster either aliases into
  // dashes from afar or blurs up close. Two rasters, swapped by camera height.
  const bordersFine = await canvasLayer(viewer, bordersCanvas(counties, 4096), BOUNDS);
  const bordersCoarse = await canvasLayer(viewer, bordersCanvas(counties, 1400, 0.8), BOUNDS);
  // Township lines go beneath the county lines (index 1: just above the imagery).
  const towns = await loadTowns();
  const townBorders = await canvasLayer(viewer, townBordersCanvas(towns), BOUNDS, 1);
  const overlays = [bordersFine, bordersCoarse, townBorders];
  let townsEnabled = true;
  const townLevel = () => townsEnabled && viewer.camera.positionCartographic.height < TOWN_LEVEL;
  const pickBorders = () => {
    const far = viewer.camera.positionCartographic.height > BORDER_SWITCH;
    if (bordersCoarse.show !== far) {
      bordersCoarse.show = far;
      bordersFine.show = !far;
    }
    townBorders.show = townLevel();
  };
  bordersFine.show = false;
  viewer.camera.changed.addEventListener(pickBorders);
  viewer.camera.percentageChanged = 0.1;
  const highlights = new Map(); // name → Promise<ImageryLayer>
  const highlightLayers = [];
  let sky = "night";

  const highlightLayer = (name) => {
    if (!highlights.has(name)) {
      const feature = counties.find((c) => c.name === name) ?? towns.find((t) => t.name === name);
      highlights.set(name, (async () => {
        const { canvas, bounds } = highlightCanvas(feature);
        const layer = await canvasLayer(viewer, canvas, bounds);
        layer.show = false;
        layer.brightness = HIGHLIGHT_BRIGHTNESS[sky];
        highlightLayers.push(layer);
        return layer;
      })());
    }
    return highlights.get(name);
  };

  let hovered = null;
  let selected = null;
  const shown = new Set();
  const refreshHighlights = async () => {
    const wanted = new Set([hovered, selected].filter(Boolean));
    for (const name of new Set([...wanted, ...shown])) {
      const layer = await highlightLayer(name);
      layer.show = wanted.has(name);
    }
    shown.clear();
    wanted.forEach((name) => shown.add(name));
    scene.requestRender();
  };

  // ---------- bubbles ----------
  const anchors = new Map(countyList.map(({ name, lat, lon }) => {
    const [aLat, aLon] = LABEL_POINTS[name] ?? [lat, lon];
    return [name, { lat: aLat, lon: aLon }];
  }));
  const bubbles = new Bubbles(element.parentElement, viewer, anchors, {
    onHover: (name, position) => {
      hovered = name;
      refreshHighlights();
      onHover?.(name, position);
    },
    onSelect,
  });

  // Bubbles sit on the rendered (exaggerated) surface once terrain is ready.
  const liftBubbles = async (provider) => {
    const points = [...anchors].map(([, a]) => Cesium.Cartographic.fromDegrees(a.lon, a.lat));
    try {
      await Cesium.sampleTerrainMostDetailed(provider, points);
      bubbles.setHeights([...anchors.keys()].map((name, i) => [name, points[i].height || 0]));
    } catch (error) {
      console.warn("terrain heights unavailable", error);
    }
  };
  if (terrain) terrain.readyEvent.addEventListener(liftBubbles);

  const dataLayers = new Overlays(viewer);

  // ---------- picking by position, not by primitive ----------
  const lonLatAt = (position) => {
    const cartesian = scene.mode === Cesium.SceneMode.SCENE3D
      ? scene.globe.pick(viewer.camera.getPickRay(position), scene)
      : viewer.camera.pickEllipsoid(position);
    if (!cartesian) return null;
    const c = Cesium.Cartographic.fromCartesian(cartesian);
    return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)];
  };
  // The county under the pointer, and its township when the camera is close enough.
  const placeAt = (position) => {
    const point = lonLatAt(position);
    const county = point ? countyAt(counties, point[0], point[1]) : null;
    if (!county) return { county: null, town: null };
    return { county, town: townLevel() ? townAt(towns, county, point[0], point[1]) : null };
  };

  const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  let pending = null;
  handler.setInputAction((movement) => {
    if (pending) {
      pending = movement.endPosition;
      return;
    }
    pending = movement.endPosition;
    requestAnimationFrame(() => {
      const position = pending;
      pending = null;
      if (!position) return; // the pointer left the canvas meanwhile
      const info = dataLayers.infoFor(scene.pick(position));
      onInfo?.(info, { x: position.x, y: position.y });
      if (info) {
        scene.canvas.style.cursor = "";
        onHover?.(null);
        return;
      }
      const { county, town } = placeAt(position);
      const key = town?.name ?? county;
      if (key !== hovered) {
        hovered = key;
        scene.canvas.style.cursor = county ? "pointer" : "";
        refreshHighlights();
      }
      onHover?.(county, { x: position.x, y: position.y }, town);
    });
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  // Cesium reports moves only over the canvas, so leaving it for the dock or
  // a panel would otherwise strand the hover card and highlight in place.
  scene.canvas.addEventListener("mouseleave", () => {
    pending = null;
    onInfo?.(null);
    if (hovered) {
      hovered = null;
      scene.canvas.style.cursor = "";
      refreshHighlights();
    }
    onHover?.(null);
  });
  handler.setInputAction((click) => {
    if (dataLayers.infoFor(scene.pick(click.position))) return; // the typhoon has no county
    const { county, town } = placeAt(click.position);
    if (county) onSelect?.(county, { x: click.position.x, y: click.position.y }, town);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // ---------- camera ----------
  const flyHome = (duration = 1.5) => {
    if (scene.mode === Cesium.SceneMode.SCENE2D) {
      viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(...TAIWAN_2D), duration });
      return;
    }
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(HOME.lon, HOME.lat), 1),
      {
        offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(HOME.heading), Cesium.Math.toRadians(HOME.pitch), HOME.range),
        duration,
      },
    );
  };
  flyHome(0);
  pickBorders();

  if (token) {
    const exaggerationAt = (height) => {
      if (height <= TRUE_SCALE_BELOW) return 1;
      if (height >= FULL_SCALE_ABOVE) return EXAGGERATION;
      return 1 + (EXAGGERATION - 1) * ((height - TRUE_SCALE_BELOW) / (FULL_SCALE_ABOVE - TRUE_SCALE_BELOW));
    };
    scene.preRender.addEventListener(() => {
      const target = exaggerationAt(viewer.camera.positionCartographic.height);
      const current = scene.verticalExaggeration;
      if (Math.abs(target - current) > 0.005) {
        scene.verticalExaggeration = current + (target - current) * 0.25;
        scene.requestRender();
      }
    });
  }

  // ---------- buildings and the shadow simulation ----------
  let buildings = null;
  let userShadows = false;
  let simulating = false;
  const setBuildings = async (on) => {
    if (!token) throw new Error("建築模型需要 Cesium ion token。");
    if (on && !buildings) {
      buildings = await Cesium.createOsmBuildingsAsync();
      // One pale material reads as architecture rather than a map legend.
      buildings.style = new Cesium.Cesium3DTileStyle({ color: "color('#e8edf4', 1.0)" });
      buildings.shadows = Cesium.ShadowMode.ENABLED;
      scene.primitives.add(buildings);
    }
    if (buildings) buildings.show = on;
    scene.requestRender();
  };
  const applyShadows = () => {
    const on = simulating || userShadows;
    viewer.shadows = on;
    viewer.terrainShadows = simulating ? Cesium.ShadowMode.RECEIVE_ONLY : on ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED;
    // Close up, a short shadow distance keeps building shadows crisp.
    viewer.shadowMap.maximumDistance = simulating ? 6000 : 20000;
    viewer.shadowMap.darkness = simulating ? 0.35 : 0.3;
    scene.requestRender();
  };

  let switching = false;
  // Resolves when the globe has its tiles, or after `limit` ms, whichever is first.
  const tilesSettled = (limit) => new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      if (scene.globe.tilesLoaded || performance.now() - started > limit) {
        scene.postRender.removeEventListener(check);
        resolve();
      }
    };
    scene.postRender.addEventListener(check);
    scene.requestRender();
  });

  const firstTiles = new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      if (scene.globe.tilesLoaded || performance.now() - started > 10000) {
        scene.postRender.removeEventListener(check);
        resolve();
      }
    };
    scene.postRender.addEventListener(check);
    scene.requestRender();
  });

  return {
    viewer,
    ready: firstTiles,
    hasTerrain: Boolean(token),

    setValues(layer, values, scale) {
      bubbles.setValues(layer, values, scale);
    },

    setOverlay: (name, on) => dataLayers.set(name, on),
    refreshOverlays: () => dataLayers.refresh(),

    setTownBorders(on) {
      townsEnabled = on;
      pickBorders();
      scene.requestRender();
    },
    town: (county, name) => towns.find((t) => t.county === county && t.town === name) ?? null,

    setBuildings,

    /** Buildings on, shadows on, and the camera low over a tall skyline. */
    async startShadowSimulation(city = "taipei") {
      await setBuildings(true);
      simulating = true;
      applyShadows();
      const spot = SHADOW_CITIES[city] ?? SHADOW_CITIES.taipei;
      viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(spot.lon, spot.lat, 120), 1),
        { offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(spot.heading), Cesium.Math.toRadians(spot.pitch), spot.range), duration: 2.4 },
      );
    },

    stopShadowSimulation() {
      simulating = false;
      applyShadows();
    },

    // A township glows on its own; a county alone glows as the county.
    select(county, town = null) {
      selected = town ? `${county}${town}` : county;
      bubbles.select(county);
      refreshHighlights();
    },

    setSky(next) {
      sky = next;
      for (const layer of overlays) layer.brightness = OVERLAY_BRIGHTNESS[sky];
      for (const layer of highlightLayers) layer.brightness = HIGHLIGHT_BRIGHTNESS[sky];
      scene.requestRender();
    },

    flyTo(name, options = {}) {
      const anchor = anchors.get(name);
      if (anchor) this.flyToPoint(anchor.lon, anchor.lat, { range: 190000, ...options });
    },

    /** A township sits close in, low enough that its borders are drawn. */
    flyToTown(town, options = {}) {
      this.flyToPoint(town.center[0], town.center[1], { range: 60000, ...options });
    },

    flyToPoint(pointLon, pointLat, { panelOpen = false, range = 190000 } = {}) {
      const anchor = { lon: pointLon, lat: pointLat };
      const heading = viewer.camera.heading;
      // With the panel covering the right side, aim at a point to the camera's
      // right of the county so it lands left of centre. Shifting the target
      // before the flight keeps it one smooth move; nudging the camera after
      // it made the view jump at the end.
      let { lon, lat } = anchor;
      if (panelOpen) {
        const shift = range * 0.12; // centres it between the controls card and the panel
        const bearing = heading + Math.PI / 2;
        const earth = Cesium.Ellipsoid.WGS84.maximumRadius;
        lat += Cesium.Math.toDegrees((shift * Math.cos(bearing)) / earth);
        lon += Cesium.Math.toDegrees((shift * Math.sin(bearing)) / (earth * Math.cos(Cesium.Math.toRadians(anchor.lat))));
      }
      viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat), 1),
        {
          offset: new Cesium.HeadingPitchRange(heading, Cesium.Math.toRadians(-45), range),
          duration: 1.4,
          complete: () => scene.requestRender(),
        },
      );
    },

    flyHome,

    // null returns to live time; a Date freezes the sun and moon at that moment.
    setTime(date) {
      if (date) {
        viewer.clock.shouldAnimate = false;
        viewer.clock.currentTime = Cesium.JulianDate.fromDate(date);
      } else {
        viewer.clock.currentTime = Cesium.JulianDate.now();
        viewer.clock.shouldAnimate = true;
      }
      scene.requestRender();
    },

    setShadows(on) {
      userShadows = on;
      applyShadows();
    },

    // Cesium's morph animates out to the whole globe and would then have to
    // jump back to Taiwan. Instead the view dissolves: fade out, morph and
    // frame Taiwan while hidden, wait for tiles, fade back in.
    async setMode2D(on) {
      if (switching || (on === (scene.mode === Cesium.SceneMode.SCENE2D))) return;
      switching = true;
      const layers = [element, bubbles.layer];
      const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
      const fade = (keyframes, duration) => Promise.all(layers.map((layer) =>
        layer.animate(keyframes, { duration, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "forwards" }).finished));
      try {
        if (motion) await fade([{ opacity: 1, transform: "scale(1)", filter: "blur(0)" }, { opacity: 0, transform: "scale(0.97)", filter: "blur(6px)" }], 260);
        await new Promise((resolve) => {
          const landed = () => {
            scene.morphComplete.removeEventListener(landed);
            resolve();
          };
          scene.morphComplete.addEventListener(landed);
          if (on) scene.morphTo2D(0);
          else scene.morphTo3D(0);
        });
        if (on) viewer.camera.setView({ destination: Cesium.Rectangle.fromDegrees(...TAIWAN_2D) });
        else flyHome(0);
        await tilesSettled(700);
        if (motion) await fade([{ opacity: 0, transform: "scale(1.03)", filter: "blur(6px)" }, { opacity: 1, transform: "scale(1)", filter: "blur(0)" }], 460);
      } finally {
        for (const layer of layers) layer.getAnimations().forEach((animation) => animation.cancel());
        switching = false;
        scene.requestRender();
      }
    },
  };
}
