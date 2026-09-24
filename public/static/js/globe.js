// The 3D Taiwan: terrain, the sun and moon at their real positions, county
// borders draped as imagery, and glass value bubbles.
/* global Cesium */
import { Bubbles } from "./bubbles.js";
import { BOUNDS, bordersCanvas, countyAt, highlightCanvas, loadCounties, loadTowns, townAt, townBordersCanvas } from "./geo.js";
import { Overlays } from "./overlays.js";

// The camera aims a little south of the island's centre: the tilted view
// pushes the far north up towards the top bar.
const HOME = { lon: 120.95, lat: 23.35, heading: -12, pitch: -42, range: 600000 };
// What the 2D map frames: the main island with Penghu, Kinmen and Matsu, and
// a margin of sea on every side.
const TAIWAN_2D = [117.9, 21.4, 122.6, 26.6];
const EXAGGERATION = 2.5;
// Terrain is exaggerated from afar so the Central Range reads, and eases back
// to true scale near the ground so buildings and streets sit right.
const TRUE_SCALE_BELOW = 20000;
const FULL_SCALE_ABOVE = 150000;

// Where the building presets take the camera: tall buildings, seen from the
// south looking north, so the sun is behind the viewer and shadows fall away.
export const SHADOW_CITIES = {
  taipei: { label: "臺北 101", lon: 121.5645, lat: 25.0339, heading: 0, pitch: -24, range: 2400 },
  kaohsiung: { label: "高雄 85 大樓", lon: 120.3006, lat: 22.6116, heading: 0, pitch: -24, range: 2200 },
  taichung: { label: "臺中 七期", lon: 120.6440, lat: 24.1630, heading: 0, pitch: -26, range: 2400 },
};

// Bubble anchors inside each county, spread so the crowded north and the
// county/city pairs (Hsinchu, Chiayi) do not stack at the default view.
// Counties not listed use CWA's representative point.
const LABEL_POINTS = {
  基隆市: [25.13, 121.74],
  臺北市: [25.09, 121.56],
  新北市: [24.93, 121.50],
  桃園市: [24.86, 121.24],
  宜蘭縣: [24.62, 121.69],
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

// A canvas draped as imagery. Handing Cesium the canvas itself skips the PNG
// round trip (toDataURL then decode), which took a few hundred milliseconds
// per 4096-pixel raster. SingleTileImageryProvider returns `_image` without
// loading its url once it is set, as fromUrl() itself does (Cesium 1.145).
function canvasLayer(viewer, canvas, bounds, index) {
  const provider = new Cesium.SingleTileImageryProvider({
    url: "data:,",
    tileWidth: canvas.width,
    tileHeight: canvas.height,
    rectangle: Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north),
  });
  provider._image = canvas;
  return viewer.imageryLayers.addImageryProvider(provider, index);
}

function haversine(lon1, lat1, lon2, lat2) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// Resolves when the browser has a spare moment, so deferred work does not
// compete with the first frames.
const idle = () => new Promise((resolve) => {
  if (window.requestIdleCallback) requestIdleCallback(() => resolve(), { timeout: 1000 });
  else setTimeout(resolve, 100);
});

// The loading card lifts when the first view's tiles are in, or after this
// long: the rest stream in and sharpen while the page is already usable.
const FIRST_VIEW_MS = 2500;

export async function createGlobe(element, { token, counties: countyList, onHover, onInfo, onSelect, onMode, onTyphoon }) {
  // The county geometry downloads while Cesium sets up.
  const countiesLoading = loadCounties();
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
  // At Cesium's default bias (2e-5) the buildings shadow themselves: every lit
  // wall showed a moiré of stripes. The bias has no public setter; the shader
  // reads it as a uniform each frame.
  viewer.shadowMap._primitiveBias.depthBias = 1e-3;
  viewer.creditDisplay.addStaticCredit(new Cesium.Credit("資料：中央氣象署開放資料 · 縣市界：內政部國土測繪中心", false));
  viewer.clock.currentTime = Cesium.JulianDate.now();
  viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK;

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
  // Aim at Taiwan first, so the first tiles requested are Taiwan's, not the whole globe's.
  flyHome(0);

  // tilesLoaded is also true before the first tile is even requested, so it
  // counts only once the load queue has been busy.
  let tilesRequested = false;
  const watchQueue = (length) => {
    if (length > 0) tilesRequested = true;
  };
  scene.globe.tileLoadProgressEvent.addEventListener(watchQueue);
  const firstTiles = new Promise((resolve) => {
    const done = () => {
      scene.postRender.removeEventListener(check);
      scene.globe.tileLoadProgressEvent.removeEventListener(watchQueue);
      resolve();
    };
    const check = () => {
      if (tilesRequested && scene.globe.tilesLoaded) done();
    };
    scene.postRender.addEventListener(check);
    setTimeout(done, FIRST_VIEW_MS);
    scene.requestRender();
  });

  // ---------- county geometry, borders and highlights ----------
  const counties = await countiesLoading;
  let sky = "night";
  // A single image has no mipmaps, so one border raster either aliases into
  // dashes from afar or blurs up close. Two rasters, swapped by camera height.
  // Only the coarse one is needed for the first, distant view; the fine one
  // and the township lines are drawn after it (see `details` below).
  const bordersCoarse = canvasLayer(viewer, bordersCanvas(counties, 1400, 0.8), BOUNDS);
  let bordersFine = null;
  let townBorders = null;
  let towns = [];
  const overlays = [bordersCoarse];
  const townLevel = () => viewer.camera.positionCartographic.height < TOWN_LEVEL;
  const pickBorders = () => {
    const far = viewer.camera.positionCartographic.height > BORDER_SWITCH;
    bordersCoarse.show = far || !bordersFine;
    if (bordersFine) bordersFine.show = !far;
    if (townBorders) townBorders.show = townLevel();
  };
  viewer.camera.changed.addEventListener(pickBorders);
  viewer.camera.percentageChanged = 0.1;
  const addBorders = (canvas, index) => {
    const layer = canvasLayer(viewer, canvas, BOUNDS, index);
    layer.brightness = OVERLAY_BRIGHTNESS[sky];
    overlays.push(layer);
    return layer;
  };
  // After the first view: the fine county lines, then the townships, which
  // are needed only close in (below TOWN_LEVEL) and for township links.
  const details = (async () => {
    await firstTiles;
    await idle();
    // In the coarse raster's slot, so highlights added since stay on top.
    bordersFine = addBorders(bordersCanvas(counties, 4096), viewer.imageryLayers.indexOf(bordersCoarse));
    pickBorders();
    const loaded = await loadTowns();
    await idle();
    // Township lines go beneath the county lines (index 1: just above the imagery).
    townBorders = addBorders(townBordersCanvas(loaded), 1);
    towns = loaded;
    pickBorders();
    scene.requestRender();
  })();
  details.catch((error) => console.warn("township borders unavailable", error));

  // Every eighth vertex of each county's outer rings: about a kilometre apart,
  // plenty for "the typhoon is 850 km from Taiwan".
  const coast = counties.flatMap((county) => county.polygons.flatMap((polygon) =>
    polygon[0].filter((_, i) => i % 8 === 0).map(([lon, lat]) => [lon, lat, county.name])));

  const highlights = new Map(); // name → Promise<ImageryLayer>
  const highlightLayers = [];

  const built = new Map(); // name → ImageryLayer, once its raster exists
  const highlightLayer = (name) => {
    if (!highlights.has(name)) {
      const feature = counties.find((c) => c.name === name) ?? towns.find((t) => t.name === name);
      highlights.set(name, (async () => {
        const { canvas, bounds } = highlightCanvas(feature);
        const layer = canvasLayer(viewer, canvas, bounds);
        layer.brightness = HIGHLIGHT_BRIGHTNESS[sky];
        highlightLayers.push(layer);
        built.set(name, layer);
        return layer;
      })());
    }
    return highlights.get(name);
  };

  let hovered = null;
  let selected = null;
  // Rasters are built asynchronously, so a slow one can land after the pointer
  // has moved on. Visibility is therefore decided from the state at the end,
  // over every built layer: exactly the hovered and selected ones glow.
  const refreshHighlights = async () => {
    await Promise.all([hovered, selected].filter(Boolean).map(highlightLayer));
    const wanted = new Set([hovered, selected].filter(Boolean));
    for (const [name, layer] of built) layer.show = wanted.has(name);
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
  if (terrain) terrain.readyEvent.addEventListener((provider) => firstTiles.then(idle).then(() => liftBubbles(provider)));

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
  // Cesium reports moves only over the canvas, so leaving it for the top bar or
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
    const hit = dataLayers.hit(scene.pick(click.position));
    if (hit) {
      if (hit.cyclone !== undefined) onTyphoon?.(hit.cyclone);
      return; // the typhoon has no county
    }
    const { county, town } = placeAt(click.position);
    if (county) onSelect?.(county, { x: click.position.x, y: click.position.y }, town);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

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
      } else if (current !== target) {
        scene.verticalExaggeration = target;
        scene.requestRender();
      }
      updateBuildings();
    });
  }

  // ---------- buildings and the shadow simulation ----------
  let buildings = null;
  let buildingsWanted = false;
  let simulating = false;
  // True in 2D and throughout a morph either way: only a finished 3D scene
  // draws buildings and shadows.
  let mode2D = false;
  // The buildings are drawn (and so load their tiles) only in 3D, close in,
  // at true scale. Tiles loaded while the terrain was still exaggerated kept
  // that stretch after the camera came down, and building models cannot be
  // projected into 2D at all: rendering stopped with an error.
  const updateBuildings = () => {
    if (!buildings) return;
    const show = buildingsWanted && !mode2D && scene.mode === Cesium.SceneMode.SCENE3D
      && viewer.camera.positionCartographic.height < TRUE_SCALE_BELOW
      && scene.verticalExaggeration === 1;
    if (buildings.show !== show) {
      buildings.show = show;
      scene.requestRender();
    }
  };
  viewer.camera.changed.addEventListener(updateBuildings);
  const setBuildings = async (on) => {
    if (!token) throw new Error("建築模型需要 Cesium ion token。");
    buildingsWanted = on;
    if (on && !buildings) {
      buildings = await Cesium.createOsmBuildingsAsync();
      // One pale material reads as architecture rather than a map legend.
      buildings.style = new Cesium.Cesium3DTileStyle({ color: "color('#e8edf4', 1.0)" });
      buildings.shadows = Cesium.ShadowMode.ENABLED;
      buildings.show = false;
      scene.primitives.add(buildings);
    }
    updateBuildings();
    scene.requestRender();
  };
  const applyShadows = () => {
    const on = simulating && !mode2D;
    viewer.shadows = on;
    viewer.terrainShadows = on ? Cesium.ShadowMode.RECEIVE_ONLY : Cesium.ShadowMode.DISABLED;
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

  return {
    viewer,
    ready: firstTiles,
    // Township geometry arrives after the first view; links to a township wait on it.
    townsReady: details,
    hasTerrain: Boolean(token),

    setValues(layer, values, scale) {
      bubbles.setValues(layer, values, scale);
    },

    setOverlay: (name, on) => dataLayers.set(name, on),
    refreshOverlays: () => dataLayers.refresh(),

    typhoons: () => dataLayers.typhoons(),
    /** When the typhoon's satellite cloud was taken (ISO), or null. */
    typhoonCloudTime: () => dataLayers.cloudTime(),
    /** Show a marker for cyclone `index` at an interpolated point, or hide it with null. */
    scrubTyphoon: (index, point) => dataLayers.scrub(index, point),
    flyToTyphoon(lon, lat) {
      viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat), 1), {
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-58), 2600000),
        duration: 1.8,
      });
    },
    /** Great-circle distance in km from a point to Taiwan's nearest coast, and that county. */
    distanceToTaiwan(lon, lat) {
      let best = { km: Infinity, county: null };
      for (const [pLon, pLat, county] of coast) {
        const km = haversine(lon, lat, pLon, pLat);
        if (km < best.km) best = { km, county };
      }
      return best;
    },

    town: (county, name) => towns.find((t) => t.county === county && t.town === name) ?? null,

    setBuildings,

    /** Buildings on, and the camera low over a tall skyline (in 3D: buildings have no 2D form). */
    async showCity(city = "taipei") {
      if (mode2D) await this.setMode2D(false);
      await setBuildings(true);
      const spot = SHADOW_CITIES[city] ?? SHADOW_CITIES.taipei;
      viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(spot.lon, spot.lat, 120), 1),
        { offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(spot.heading), Cesium.Math.toRadians(spot.pitch), spot.range), duration: 2.4 },
      );
    },

    /** The skyline, with shadows cast by the buildings. */
    async startShadowSimulation(city = "taipei") {
      simulating = true;
      applyShadows();
      await this.showCity(city);
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
      dataLayers.setBrightness(OVERLAY_BRIGHTNESS[sky]);
      scene.requestRender();
    },

    flyTo(name, options = {}) {
      const anchor = anchors.get(name);
      if (anchor) this.flyToPoint(anchor.lon, anchor.lat, { range: 190000, ...options });
    },

    /** A township sits close in, low enough that its borders are drawn. */
    flyToTown(town, { keepHeight = false, ...options } = {}) {
      // From a click, keep roughly the height the user chose, but never so far
      // out that townships stop being drawn.
      const height = viewer.camera.positionCartographic.height;
      const range = keepHeight ? Math.min(Math.max(height * 1.35, 8000), TOWN_LEVEL * 0.9) : 60000;
      this.flyToPoint(town.center[0], town.center[1], { range, ...options });
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

    // Cesium's morph animates out to the whole globe and would then have to
    // jump back to Taiwan. Instead the view dissolves: fade out, morph and
    // frame Taiwan while hidden, wait for tiles, fade back in.
    async setMode2D(on) {
      if (switching || (on === (scene.mode === Cesium.SceneMode.SCENE2D))) return;
      switching = true;
      // A flight still under way (a preset, say) would keep steering the
      // camera through the morph and leave 2D a kilometre above one city.
      viewer.camera.cancelFlight();
      // Buildings and their shadows leave before the morph renders a frame,
      // and come back only once the scene is 3D again: shown in a 2D frame,
      // a building tile cannot be projected and rendering stops.
      mode2D = true;
      updateBuildings();
      applyShadows();
      onMode?.(on);
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
        mode2D = scene.mode !== Cesium.SceneMode.SCENE3D;
        updateBuildings();
        applyShadows();
        switching = false;
        scene.requestRender();
      }
    },
  };
}
