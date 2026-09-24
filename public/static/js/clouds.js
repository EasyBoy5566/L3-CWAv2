// The typhoon's real cloud: Himawari-9's clean infrared band (NASA GIBS, every
// ten minutes, about an hour behind), turned into white cloud and faded out
// around each cyclone so it reads as the storm, not as a weather layer.
/* global Cesium */

const LAYER = "Himawari_AHI_Band13_Clean_Infrared";
const BASE = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${LAYER}/default`;
const tileUrl = (time) => `${BASE}/${time}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`;
const MAX_LEVEL = 6;
// Older than this, the picture no longer shows where the storm is.
const STALE_MS = 6 * 3600 * 1000;

/** The time of the newest Himawari image, or null when GIBS has none recent. */
export async function latestCloudTime({ timeout = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    // A request for "default" answers with the newest image and names its time.
    const response = await fetch(tileUrl("default").replace("{z}/{y}/{x}", "0/0/0"), { signal: controller.signal });
    const time = response.ok ? response.headers.get("layer-time-actual") : null;
    if (!time || Date.now() - Date.parse(time) > STALE_MS) return null;
    return time;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// How cold a pixel's cloud top is (0 clear sea, 1 the coldest tops), read
// from GIBS's enhanced infrared palette. Warm sea is grey ~99 and cloud
// brightens to ~200 as its top gets colder; colder still, the palette turns
// blue, cyan, green, yellow, red, and finally dark grey.
function coldness(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min > 30) {
    const d = max - min;
    let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
    // Blue (240°) is the least cold colour, red (0°) the coldest.
    return 0.66 + 0.3 * (1 - Math.min(hue, 240) / 240);
  }
  if (r < 80) return 1;
  return 0.62 * smoothstep(104, 200, r);
}

// GIBS resamples its coarser levels with hard pixels; a light blur keeps the
// eye and the cloud edges from looking blocky. Blurred alone, a tile would
// fade at its borders and every seam would show as a line, so it is first
// padded with copies of its own edge pixels. (Safari ignores the filter.)
const PAD = 4;
function soften(canvas) {
  const size = canvas.width;
  const padded = document.createElement("canvas");
  padded.width = padded.height = size + PAD * 2;
  const p = padded.getContext("2d");
  const last = size - 1;
  p.drawImage(canvas, 0, 0, size, 1, PAD, 0, size, PAD); // top
  p.drawImage(canvas, 0, last, size, 1, PAD, size + PAD, size, PAD); // bottom
  p.drawImage(canvas, 0, 0, 1, size, 0, PAD, PAD, size); // left
  p.drawImage(canvas, last, 0, 1, size, size + PAD, PAD, PAD, size); // right
  p.drawImage(canvas, PAD, PAD);
  const out = document.createElement("canvas");
  out.width = out.height = size;
  const o = out.getContext("2d");
  o.filter = "blur(1.2px)";
  o.drawImage(padded, -PAD, -PAD);
  return out;
}

// Web Mercator row → latitude, for a tile's pixel rows.
const mercatorLat = (y) => (Math.atan(Math.sinh(y)) * 180) / Math.PI;

/**
 * One imagery layer of cloud around (lon, lat): full out to `inner` km, gone
 * by `outer` km. Returns the layer, already added to the globe.
 */
export function addCloudLayer(viewer, time, { lon, lat, inner, outer }) {
  const kmPerLon = 111.32 * Math.cos((lat * Math.PI) / 180);
  const pad = outer / 110 + 0.5;
  const rectangle = Cesium.Rectangle.fromDegrees(lon - pad * (111.32 / kmPerLon), lat - pad, lon + pad * (111.32 / kmPerLon), lat + pad);
  const provider = new Cesium.UrlTemplateImageryProvider({
    url: tileUrl(time),
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    maximumLevel: MAX_LEVEL,
    rectangle,
    credit: new Cesium.Credit("衛星雲圖：NASA GIBS · JMA Himawari-9", false),
  });
  const request = provider.requestImage.bind(provider);
  provider.requestImage = (x, y, level, ...rest) => {
    const loading = request(x, y, level, ...rest);
    // undefined means "throttled, ask again later"; pass that through.
    return loading && loading.then((image) => whiten(image, provider.tilingScheme.tileXYToNativeRectangle(x, y, level)));
  };

  // Colour and alpha for every pixel: white cloud, thin cloud a little grey,
  // faded by distance from the centre.
  function whiten(image, native) {
    const size = image.width;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    // Cesium decodes tiles into ImageBitmaps already flipped upside down (WebGL
    // cannot flip those on upload) but flips a canvas on upload. Turned back
    // the right way up, row 0 is the tile's north edge as the maths below expects.
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
      context.translate(0, size);
      context.scale(1, -1);
    }
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, size, size);
    const data = pixels.data;
    const radius = Cesium.Ellipsoid.WGS84.maximumRadius;
    for (let row = 0; row < size; row += 1) {
      const my = native.north - ((row + 0.5) / size) * (native.north - native.south);
      const dy = (mercatorLat(my / radius) - lat) * 110.57;
      for (let col = 0; col < size; col += 1) {
        const i = (row * size + col) * 4;
        const mx = native.west + ((col + 0.5) / size) * (native.east - native.west);
        const dx = (((mx / radius) * 180) / Math.PI - lon) * kmPerLon;
        const fade = 1 - smoothstep(inner, outer, Math.hypot(dx, dy));
        const c = fade > 0 ? coldness(data[i], data[i + 1], data[i + 2]) : 0;
        // Thin, low cloud is grey-blue and see-through; cold, deep cloud bright
        // and opaque, so the storm keeps its texture instead of one white blob.
        const shade = 176 + 79 * c;
        data[i] = shade;
        data[i + 1] = shade + 6 * (1 - c);
        data[i + 2] = Math.min(255, shade + 16 * (1 - c));
        data[i + 3] = 250 * smoothstep(0.02, 0.5, c) * fade;
      }
    }
    context.putImageData(pixels, 0, 0);
    return soften(canvas);
  }

  const layer = viewer.imageryLayers.addImageryProvider(provider);
  // Resampled from 2 km pixels, so smooth rather than blocky up close.
  layer.magnificationFilter = Cesium.TextureMagnificationFilter.LINEAR;
  return layer;
}
