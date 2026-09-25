// The 3D Taiwan: terrain, the sun and moon at their real positions, county
// borders draped as imagery, and a value standee for each county.
/* global Cesium */
import { BOUNDS, bordersCanvas, countyAt, highlightCanvas, loadCounties, loadTowns, townAt } from "./geo.js";
import { cityShader, Rain, WEATHER } from "./city-light.js";
import { Overlays } from "./overlays.js";
import { Standees } from "./standees.js";

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

// Imagery is lit with the globe, so draped overlays darken at night; these
// brightness factors keep them readable after dark.
const OVERLAY_BRIGHTNESS = { day: 1, dusk: 1.4, night: 1.8 };
// The selection outline must glow at any hour, so it is lifted further.
const HIGHLIGHT_BRIGHTNESS = { day: 1.2, dusk: 2.2, night: 3.4 };
// Below this camera height townships are drawn, hovered and picked; above it,
// counties. The fine border raster (county and township lines) takes over
// from the coarse one at the same height.
const TOWN_LEVEL = 350000;
// Each highlight is a raster and a texture of its own (about 10 MB for a
// county); only the most recent few are kept.
const KEEP_HIGHLIGHTS = 6;
// OSM Buildings would otherwise cache up to 512 MB of tiles.
const BUILDING_CACHE_BYTES = 160 * 1024 * 1024;
// Google's photographed cities default to a 1.5 GB cache.
const PHOTOREAL_CACHE_BYTES = 400 * 1024 * 1024;

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
  const layer = viewer.imageryLayers.addImageryProvider(provider, index);
  releaseWhenUploaded(viewer, layer, provider, canvas);
  return layer;
}

// Once Cesium has made its texture from a raster, the canvas is a second
// full copy (~70 MB for the 4096 one). It is swapped for a PNG of itself,
// which the browser may drop from memory and decode again should Cesium ever
// ask for the image anew, and the canvas is emptied.
function releaseWhenUploaded(viewer, layer, provider, canvas) {
  const check = () => {
    if (layer.isDestroyed()) {
      viewer.scene.postRender.removeEventListener(check);
      return;
    }
    const uploaded = Object.values(layer._imageryCache ?? {}).some((imagery) => imagery.texture);
    if (!uploaded) return;
    viewer.scene.postRender.removeEventListener(check);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const image = new Image();
      image.src = URL.createObjectURL(blob);
      // Loaded, not decoded: it stays a compressed PNG unless Cesium uses it.
      const loaded = await new Promise((resolve) => {
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
      });
      URL.revokeObjectURL(image.src); // the loaded image keeps its data
      if (!loaded) return; // keep the canvas
      provider._image = image;
      canvas.width = 0;
      canvas.height = 0;
    }, "image/png");
  };
  viewer.scene.postRender.addEventListener(check);
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

export async function createGlobe(element, { token, counties: countyList, onHover, onInfo, onSelect, onMode, onTyphoon, onCityView, onHeading }) {
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
    // What Cesium holds before a single tile loads was ~340 MB, most of it
    // full-screen buffers. Measured on a bare viewer:
    // 4x multisampling held about 90 MB of framebuffer for edges 2x draws
    // nearly as well.
    msaaSamples: 2,
    // The canvas's own antialiasing doubled that for nothing: Cesium draws
    // into its multisampled framebuffer and only copies the result out (~70 MB).
    contextOptions: { webgl: { antialias: false } },
    // Order-independent translucency keeps several full-screen buffers
    // (~60 MB) for overlapping see-through shapes this map barely has.
    orderIndependentTranslucency: false,
    // The star box is six 1024-pixel textures (~60 MB) for sky the views
    // here hardly show; space is the page's night blue instead.
    skyBox: false,
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
  // Without a sky box the viewer makes no sun or moon either.
  scene.sun ??= new Cesium.Sun();
  scene.moon ??= new Cesium.Moon();
  scene.moon.show = true;
  scene.sun.show = true;
  scene.backgroundColor = Cesium.Color.fromCssColorString("#070b18");
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
  // Only the coarse one is needed for the first, distant view; the fine one,
  // with the township lines in it, is drawn after it (see `details` below).
  const bordersCoarse = canvasLayer(viewer, bordersCanvas(counties, 1400, 0.8), BOUNDS);
  let bordersFine = null;
  let towns = [];
  const overlays = [bordersCoarse];
  const townLevel = () => viewer.camera.positionCartographic.height < TOWN_LEVEL;
  const pickBorders = () => {
    const near = townLevel();
    bordersCoarse.show = !near || !bordersFine;
    if (bordersFine) bordersFine.show = near;
  };
  viewer.camera.changed.addEventListener(pickBorders);
  viewer.camera.percentageChanged = 0.1;
  const addBorders = (canvas, index) => {
    const layer = canvasLayer(viewer, canvas, BOUNDS, index);
    layer.brightness = OVERLAY_BRIGHTNESS[sky];
    overlays.push(layer);
    return layer;
  };
  // After the first view: the townships, needed only close in (below
  // TOWN_LEVEL) and for township links, and the fine raster with their lines
  // under the county lines. One 4096 raster instead of two saves ~80 MB.
  const details = (async () => {
    await firstTiles;
    const loaded = await loadTowns();
    await idle();
    // In the coarse raster's slot, so highlights added since stay on top.
    bordersFine = addBorders(bordersCanvas(counties, 4096, 1, loaded), viewer.imageryLayers.indexOf(bordersCoarse));
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
        // A township covers a few kilometres; half the resolution is plenty.
        const { canvas, bounds } = highlightCanvas(feature, feature.town ? 800 : 1400);
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
  // Beyond the few most recently used, rasters are destroyed: sweeping the
  // pointer across the island used to leave one per township, near 1 GB.
  const refreshHighlights = async () => {
    await Promise.all([hovered, selected].filter(Boolean).map(highlightLayer));
    const wanted = new Set([hovered, selected].filter(Boolean));
    for (const [name, layer] of built) layer.show = wanted.has(name);
    for (const name of wanted) {
      const layer = built.get(name);
      if (!layer) continue;
      built.delete(name); // re-inserted last: the Map's order is recency
      built.set(name, layer);
    }
    for (const [name, layer] of built) {
      if (built.size <= KEEP_HIGHLIGHTS) break;
      if (wanted.has(name)) continue;
      built.delete(name);
      highlights.delete(name);
      highlightLayers.splice(highlightLayers.indexOf(layer), 1);
      viewer.imageryLayers.remove(layer, true);
    }
    scene.requestRender();
  };

  // ---------- standees ----------
  // Each county's label point, from its shape (centroid, or pole of
  // inaccessibility; see scripts/build_geo.py). CWA's point if it has none.
  const anchors = new Map(countyList.map(({ name, lat, lon }) => {
    const label = counties.find((c) => c.name === name)?.label;
    return [name, label ? { lon: label[0], lat: label[1] } : { lat, lon }];
  }));
  const standees = new Standees(viewer, anchors);

  // Standees stand on the ground once its height there is known.
  const groundStandees = async (provider) => {
    const points = [...anchors].map(([, a]) => Cesium.Cartographic.fromDegrees(a.lon, a.lat));
    try {
      await Cesium.sampleTerrainMostDetailed(provider, points);
      standees.setHeights([...anchors.keys()].map((name, i) => [name, points[i].height || 0]));
    } catch (error) {
      console.warn("terrain heights unavailable", error);
    }
  };
  if (terrain) terrain.readyEvent.addEventListener((provider) => firstTiles.then(idle).then(() => groundStandees(provider)));

  const dataLayers = new Overlays(viewer);

  // The selected township's weather stations: small dots, named on hover.
  const stationDots = new Cesium.CustomDataSource("stations");
  // Where the viewer is, from the browser's location: a dot and its accuracy.
  const here = new Cesium.CustomDataSource("here");
  viewer.dataSources.add(here);
  // The compass needle follows the heading; renders happen only on change.
  let reportedHeading = null;
  scene.postRender.addEventListener(() => {
    const heading = Cesium.Math.toDegrees(viewer.camera.heading);
    if (reportedHeading === null || Math.abs(heading - reportedHeading) > 0.2) {
      reportedHeading = heading;
      onHeading?.(heading);
    }
  });
  viewer.dataSources.add(stationDots);
  const stationInfo = (picked) =>
    (picked?.id && stationDots.entities.contains(picked.id) ? { title: picked.id.name, lines: [] } : null);

  // ---------- picking by position, not by primitive ----------
  const lonLatAt = (position) => {
    let cartesian;
    // Under Google's mesh the globe is hidden, so the mesh itself is picked.
    if (!scene.globe.show && scene.pickPositionSupported) cartesian = scene.pickPosition(position);
    else if (scene.mode === Cesium.SceneMode.SCENE3D) cartesian = scene.globe.pick(viewer.camera.getPickRay(position), scene);
    else cartesian = viewer.camera.pickEllipsoid(position);
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
      const picked = scene.pick(position);
      // A standee: its county, as if the pointer were over the county itself.
      const standing = standees.countyOf(picked);
      if (standing) {
        onInfo?.(null);
        if (standing !== hovered) {
          hovered = standing;
          refreshHighlights();
        }
        scene.canvas.style.cursor = "pointer";
        onHover?.(standing, { x: position.x, y: position.y });
        return;
      }
      const info = stationInfo(picked) ?? dataLayers.infoFor(picked);
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
    const picked = scene.pick(click.position);
    const standing = standees.countyOf(picked);
    if (standing) {
      onSelect?.(standing, { x: click.position.x, y: click.position.y });
      return;
    }
    const hit = dataLayers.hit(picked);
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
  // Google's photorealistic 3D Tiles (through Cesium ion) instead of OSM Buildings.
  let photoreal = false;
  let buildingsArePhotoreal = false;
  // Put aside, not destroyed, when switched off: each new Google tileset is a
  // root request against the monthly quota, and one serves for hours.
  let googleKept = null;
  const googleShader = cityShader();
  const rain = new Rain(scene);
  let weather = WEATHER.clear;
  let googleShown = false;
  const reportView = () => {
    const c = viewer.camera.positionCartographic;
    onCityView?.(Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude));
  };
  // The buildings are drawn (and so load their tiles) only in 3D, close in,
  // at true scale. Tiles loaded while the terrain was still exaggerated kept
  // that stretch after the camera came down, and building models cannot be
  // projected into 2D at all: rendering stopped with an error.
  const updateBuildings = () => {
    const show = Boolean(buildings) && buildingsWanted && !mode2D && scene.mode === Cesium.SceneMode.SCENE3D
      && viewer.camera.positionCartographic.height < TRUE_SCALE_BELOW
      && scene.verticalExaggeration === 1;
    if (buildings && buildings.show !== show) {
      buildings.show = show;
      scene.requestRender();
    }
    // Google's mesh has its own ground, which the globe's would cut through.
    const google = show && buildingsArePhotoreal;
    if (scene.globe.show !== !google) {
      scene.globe.show = !google;
      scene.requestRender();
    }
    if (google !== googleShown) {
      googleShown = google;
      rain.show(google ? weather.rain : 0);
      if (google) reportView();
    }
  };
  viewer.camera.changed.addEventListener(updateBuildings);
  // The weather is looked up where the camera settles.
  viewer.camera.moveEnd.addEventListener(() => {
    if (googleShown) reportView();
  });
  let buildingsLoading = null;
  const loadBuildings = async () => {
    const google = photoreal;
    let tileset = null;
    if (google && googleKept) {
      tileset = googleKept;
      googleKept = null;
    } else if (google) {
      tileset = await Cesium.createGooglePhotorealistic3DTileset(
        { onlyUsingWithGoogleGeocoder: true }, // the viewer has no geocoder
        { cacheBytes: PHOTOREAL_CACHE_BYTES, maximumCacheOverflowBytes: PHOTOREAL_CACHE_BYTES / 4, showCreditsOnScreen: true },
      );
      tileset.customShader = googleShader;
      scene.primitives.add(tileset);
    } else if (!tileset) {
      tileset = await Cesium.createOsmBuildingsAsync({
        cacheBytes: BUILDING_CACHE_BYTES,
        maximumCacheOverflowBytes: BUILDING_CACHE_BYTES / 4,
      });
      // One pale material reads as architecture rather than a map legend.
      tileset.style = new Cesium.Cesium3DTileStyle({ color: "color('#e8edf4', 1.0)" });
      scene.primitives.add(tileset);
    }
    tileset.shadows = Cesium.ShadowMode.ENABLED;
    tileset.show = false;
    buildings = tileset;
    buildingsArePhotoreal = google;
    applyShadows();
  };
  // OSM Buildings are destroyed, not hidden: their tiles and textures are
  // freed, and switching back on streams them again. Google's are kept.
  const dropBuildings = () => {
    if (buildingsArePhotoreal) {
      buildings.show = false;
      googleKept = buildings;
    } else {
      scene.primitives.remove(buildings);
    }
    buildings = null;
    buildingsArePhotoreal = false;
    applyShadows();
  };
  const setBuildings = async (on) => {
    if (!token) throw new Error("建築模型需要 Cesium ion token。");
    buildingsWanted = on;
    if (on && !buildings) {
      buildingsLoading ??= loadBuildings().finally(() => { buildingsLoading = null; });
      await buildingsLoading;
    }
    if (!buildingsWanted && buildings) dropBuildings();
    updateBuildings();
    scene.requestRender();
  };
  // Swapping the source drops the loaded tileset; the other streams in if wanted.
  const setPhotoreal = async (on) => {
    if (photoreal === on) return;
    photoreal = on;
    await buildingsLoading;
    if (buildings && buildingsArePhotoreal !== on) dropBuildings();
    await setBuildings(buildingsWanted);
  };
  const setCityWeather = (kind) => {
    weather = WEATHER[kind] ?? WEATHER.clear;
    googleShader.setUniform("u_overcast", weather.overcast);
    googleShader.setUniform("u_fog", weather.fog);
    rain.show(googleShown ? weather.rain : 0);
  };
  const applyShadows = () => {
    const on = simulating && !mode2D;
    viewer.shadows = on;
    viewer.terrainShadows = on ? Cesium.ShadowMode.RECEIVE_ONLY : Cesium.ShadowMode.DISABLED;
    // Close up, a short shadow distance keeps building shadows crisp.
    viewer.shadowMap.maximumDistance = simulating ? 6000 : 20000;
    // The photographs already hold the day's own shadows; cast ones stay light.
    viewer.shadowMap.darkness = !simulating ? 0.3 : buildingsArePhotoreal ? 0.6 : 0.35;
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
      standees.setValues(layer, values, scale);
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
    setPhotoreal,
    /** The weather laid over Google's city: a kind from icons.js kindFromText. */
    setCityWeather,

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
      standees.select(county);
      refreshHighlights();
    },

    /** Mark stations ({ name, lon, lat }) with small dots; [] clears them. */
    showStations(stations) {
      stationDots.entities.removeAll();
      for (const station of stations) {
        stationDots.entities.add({
          name: station.name,
          position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat),
          point: {
            pixelSize: 8,
            color: Cesium.Color.WHITE.withAlpha(0.95),
            outlineColor: Cesium.Color.fromCssColorString("#0b1220").withAlpha(0.85),
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
      scene.requestRender();
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

    // The left column and the county panel are the same width, so the middle
    // of the screen is the middle of the map left visible: no offset needed.
    flyToPoint(lon, lat, { range = 190000 } = {}) {
      const heading = viewer.camera.heading;
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

    /** North up, turning about the point in the middle of the view. */
    resetNorth() {
      const { camera } = viewer;
      const level = { heading: 0, pitch: camera.pitch, roll: 0 };
      if (scene.mode !== Cesium.SceneMode.SCENE3D) {
        camera.setView({ orientation: level });
        return;
      }
      const middle = new Cesium.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2);
      const target = !scene.globe.show && scene.pickPositionSupported
        ? scene.pickPosition(middle)
        : scene.globe.pick(camera.getPickRay(middle), scene);
      if (!target) {
        camera.flyTo({ destination: camera.positionWC, orientation: level, duration: 0.8 });
        return;
      }
      const range = Cesium.Cartesian3.distance(camera.positionWC, target);
      camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 0), {
        offset: new Cesium.HeadingPitchRange(0, camera.pitch, range),
        duration: 0.8,
      });
    },

    /** Mark the viewer's own position, with a ring of its accuracy in metres. */
    showHere(lon, lat, accuracy) {
      here.entities.removeAll();
      const position = Cesium.Cartesian3.fromDegrees(lon, lat);
      const blue = Cesium.Color.fromCssColorString("#3b82f6");
      if (accuracy > 30) {
        const radius = Math.min(accuracy, 5000);
        here.entities.add({
          position,
          ellipse: { semiMajorAxis: radius, semiMinorAxis: radius, material: blue.withAlpha(0.16), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
        });
      }
      here.entities.add({
        position,
        point: {
          pixelSize: 13,
          color: blue,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 3,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      scene.requestRender();
    },

    /** The county and township at a point, once the township geometry is in. */
    async placeOf(lon, lat) {
      await details.catch(() => {});
      const county = countyAt(counties, lon, lat);
      return { county, town: county ? townAt(towns, county, lon, lat) : null };
    },

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
      const layers = [element];
      const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
      const fade = (keyframes, duration) => Promise.all(layers.map((layer) =>
        layer.animate(keyframes, { duration, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "forwards" }).finished));
      try {
        // Opacity and scale only: a CSS blur over the full-screen map stalled the
        // switch back to 3D for up to a second.
        if (motion) await fade([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.97)" }], 260);
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
        if (motion) await fade([{ opacity: 0, transform: "scale(1.03)" }, { opacity: 1, transform: "scale(1)" }], 460);
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
