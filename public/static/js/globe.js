// The 3D Taiwan: terrain, the sun and moon at their real positions, county
// borders draped as imagery, and glass value bubbles.
/* global Cesium */
import { Bubbles } from "./bubbles.js";
import { BOUNDS, bordersCanvas, countyAt, highlightCanvas, loadCounties } from "./geo.js";

const HOME = { lon: 120.95, lat: 23.65, heading: -12, pitch: -42, range: 560000 };
const EXAGGERATION = 2.5;

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

export async function createGlobe(element, { token, counties: countyList, onHover, onSelect }) {
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
  viewer.creditDisplay.addStaticCredit(new Cesium.Credit("資料：中央氣象署開放資料 · 縣市界：內政部國土測繪中心", true));
  viewer.clock.currentTime = Cesium.JulianDate.now();
  viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK;

  // ---------- county geometry, borders and highlights ----------
  const counties = await loadCounties();
  // A single image has no mipmaps, so one border raster either aliases into
  // dashes from afar or blurs up close. Two rasters, swapped by camera height.
  const bordersFine = await canvasLayer(viewer, bordersCanvas(counties, 4096), BOUNDS);
  const bordersCoarse = await canvasLayer(viewer, bordersCanvas(counties, 1400, 0.8), BOUNDS);
  const overlays = [bordersFine, bordersCoarse];
  const pickBorders = () => {
    const far = viewer.camera.positionCartographic.height > BORDER_SWITCH;
    if (bordersCoarse.show !== far) {
      bordersCoarse.show = far;
      bordersFine.show = !far;
    }
  };
  bordersFine.show = false;
  viewer.camera.changed.addEventListener(pickBorders);
  viewer.camera.percentageChanged = 0.1;
  const highlights = new Map(); // name → Promise<ImageryLayer>
  const highlightLayers = [];
  let sky = "night";

  const highlightLayer = (name) => {
    if (!highlights.has(name)) {
      const county = counties.find((c) => c.name === name);
      highlights.set(name, (async () => {
        const { canvas, bounds } = highlightCanvas(county);
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
      bubbles.setHeights([...anchors.keys()].map((name, i) => [name, (points[i].height || 0) * exaggeration + 150]));
    } catch (error) {
      console.warn("terrain heights unavailable", error);
    }
  };
  if (terrain) terrain.readyEvent.addEventListener(liftBubbles);

  // ---------- picking by position, not by primitive ----------
  const lonLatAt = (position) => {
    const cartesian = scene.mode === Cesium.SceneMode.SCENE3D
      ? scene.globe.pick(viewer.camera.getPickRay(position), scene)
      : viewer.camera.pickEllipsoid(position);
    if (!cartesian) return null;
    const c = Cesium.Cartographic.fromCartesian(cartesian);
    return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)];
  };
  const nameAt = (position) => {
    const point = lonLatAt(position);
    return point ? countyAt(counties, point[0], point[1]) : null;
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
      const name = nameAt(position);
      if (name !== hovered) {
        hovered = name;
        scene.canvas.style.cursor = name ? "pointer" : "";
        refreshHighlights();
      }
      onHover?.(name, { x: position.x, y: position.y });
    });
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  // Cesium reports moves only over the canvas, so leaving it for the dock or
  // a panel would otherwise strand the hover card and highlight in place.
  scene.canvas.addEventListener("mouseleave", () => {
    pending = null;
    if (hovered) {
      hovered = null;
      scene.canvas.style.cursor = "";
      refreshHighlights();
    }
    onHover?.(null);
  });
  handler.setInputAction((click) => {
    const name = nameAt(click.position);
    if (name) onSelect?.(name, { x: click.position.x, y: click.position.y });
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // ---------- camera ----------
  const flyHome = (duration = 1.5) => {
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

    select(name) {
      selected = name;
      bubbles.select(name);
      refreshHighlights();
    },

    setSky(next) {
      sky = next;
      for (const layer of overlays) layer.brightness = OVERLAY_BRIGHTNESS[sky];
      for (const layer of highlightLayers) layer.brightness = HIGHLIGHT_BRIGHTNESS[sky];
      scene.requestRender();
    },

    flyTo(name, { panelOpen = false } = {}) {
      const anchor = anchors.get(name);
      if (!anchor) return;
      const range = 190000;
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
      viewer.shadows = on;
      viewer.terrainShadows = on ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED;
      scene.requestRender();
    },

    setMode2D(on) {
      if (on) scene.morphTo2D(1.0);
      else scene.morphTo3D(1.0);
    },
  };
}
