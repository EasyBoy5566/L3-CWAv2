// The 3D Taiwan: terrain, sun and moon at their real positions, and 22
// clickable county polygons coloured by the active weather layer.
/* global Cesium */
import { MISSING, colorAt } from "./scale.js";

const FILL_ALPHA = 0.58;
const HOME = { lon: 120.95, lat: 23.65, heading: -12, pitch: -42, range: 560000 };

// Label anchors inside each county, spread so the crowded north and the
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

const cssColor = (css, alpha) => Cesium.Color.fromCssColorString(css).withAlpha(alpha);

function imagery(token) {
  if (token) return undefined; // Cesium ion default imagery
  // Without an ion token: Esri World Imagery, which needs no key.
  return Cesium.ImageryLayer.fromProviderAsync(
    Cesium.ArcGisMapServerImageryProvider.fromUrl("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"),
  );
}

export async function createGlobe(element, { token, counties, onHover, onSelect }) {
  if (token) Cesium.Ion.defaultAccessToken = token;
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
  if (token) options.terrain = Cesium.Terrain.fromWorldTerrain({ requestVertexNormals: true });

  const viewer = new Cesium.Viewer(element, options);
  const { scene } = viewer;
  scene.verticalExaggeration = token ? 2.5 : 1;
  scene.globe.enableLighting = true;
  scene.globe.dynamicAtmosphereLighting = true;
  scene.globe.dynamicAtmosphereLightingFromSun = true;
  scene.globe.depthTestAgainstTerrain = false;
  scene.moon.show = true;
  scene.sun.show = true;
  viewer.shadowMap.softShadows = true;
  viewer.shadowMap.size = 2048;
  viewer.creditDisplay.addStaticCredit(new Cesium.Credit("資料：中央氣象署開放資料 · 縣市界：內政部國土測繪中心", true));
  viewer.clock.currentTime = Cesium.JulianDate.now();
  viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK;

  const coordinates = new Map(counties.map((c) => [c.name, [c.lat, c.lon]]));
  const fills = new Map();
  const highlights = new Map();
  const labels = new Map();

  const source = await Cesium.GeoJsonDataSource.load("/static/geo/taiwan-counties.json", { clampToGround: true });
  const outlines = new Cesium.CustomDataSource("outlines");
  const now = Cesium.JulianDate.now();
  for (const entity of source.entities.values) {
    const name = entity.properties.name.getValue();
    entity.polygon.material = cssColor(MISSING, FILL_ALPHA);
    entity.polygon.outline = false;
    if (!fills.has(name)) fills.set(name, []);
    fills.get(name).push(entity);

    const ring = entity.polygon.hierarchy.getValue(now).positions;
    const positions = [...ring, ring[0]];
    outlines.entities.add({
      polyline: { positions, clampToGround: true, width: 1.2, material: Cesium.Color.WHITE.withAlpha(0.5) },
      properties: { name },
    });
    const highlight = outlines.entities.add({
      show: false,
      polyline: { positions, clampToGround: true, width: 3.5, material: Cesium.Color.fromCssColorString("#fde047") },
      properties: { name },
    });
    if (!highlights.has(name)) highlights.set(name, []);
    highlights.get(name).push(highlight);
  }
  await viewer.dataSources.add(source);
  await viewer.dataSources.add(outlines);

  for (const [name, [lat, lon]] of coordinates) {
    const [labelLat, labelLon] = LABEL_POINTS[name] ?? [lat, lon];
    labels.set(name, viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(labelLon, labelLat),
      properties: { name },
      label: {
        text: name,
        font: "600 14px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString("#0b1220"),
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(1.5e5, 1.15, 1.2e6, 0.62),
        translucencyByDistance: new Cesium.NearFarScalar(3e6, 1, 6e6, 0),
      },
    }));
  }

  // ---------- interaction ----------
  let hovered = null;
  let selected = null;
  const setHighlight = (name, on) => {
    for (const entity of highlights.get(name) ?? []) entity.show = on;
  };
  const nameAt = (position) => {
    const picked = scene.pick(position);
    const entity = picked?.id;
    return entity?.properties?.name?.getValue?.() ?? null;
  };

  const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  handler.setInputAction((movement) => {
    const name = nameAt(movement.endPosition);
    if (name !== hovered) {
      if (hovered && hovered !== selected) setHighlight(hovered, false);
      hovered = name;
      if (name) setHighlight(name, true);
      scene.canvas.style.cursor = name ? "pointer" : "";
      scene.requestRender();
    }
    onHover?.(name, movement.endPosition);
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction((click) => {
    const name = nameAt(click.position);
    // The canvas fills the viewport, so canvas coordinates are page coordinates.
    if (name) onSelect?.(name, { x: click.position.x, y: click.position.y });
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

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
      for (const [name, entities] of fills) {
        const entry = values[name];
        const value = entry?.value ?? null;
        const color = cssColor(colorAt(scale, value), FILL_ALPHA);
        for (const entity of entities) entity.polygon.material = color;
        const label = labels.get(name)?.label;
        if (label) {
          const shown = value === null ? "—" : `${layer === "pop" ? Math.round(value) : Number(value).toFixed(layer === "now" ? 1 : 0)}${scale.unit}`;
          label.text = `${name} ${shown}`;
        }
      }
      scene.requestRender();
    },

    select(name) {
      if (selected && selected !== name) setHighlight(selected, false);
      selected = name;
      if (name) setHighlight(name, true);
      scene.requestRender();
    },

    flyTo(name, { panelOpen = false } = {}) {
      const point = coordinates.get(name);
      if (!point) return;
      const [lat, lon] = LABEL_POINTS[name] ?? point;
      const range = 190000;
      viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat), 1),
        {
          offset: new Cesium.HeadingPitchRange(viewer.camera.heading, Cesium.Math.toRadians(-45), range),
          duration: 1.4,
          // With the panel covering the right side, nudge the county left of centre.
          complete: () => {
            if (panelOpen) viewer.camera.moveRight(range * 0.28);
            scene.requestRender();
          },
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
        viewer.creditDisplay.addStaticCredit(new Cesium.Credit("資料：中央氣象署開放資料 · 縣市界：內政部國土測繪中心", true));
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
