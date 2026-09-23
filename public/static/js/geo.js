// County geometry in plain lon/lat: hit-testing, and rasters that Cesium
// drapes over the terrain as imagery.
//
// Why rasters: Cesium's clamp-to-ground polygons and polylines are drawn as
// volumes sized from precomputed terrain heights, and with the terrain
// exaggerated the mountains rise out of those volumes, so borders vanished
// along the Central Range. Imagery follows the rendered surface exactly.

// Covers Matsu to the Hengchun peninsula and Kinmen to Lanyu.
export const BOUNDS = { west: 118.1, east: 122.1, south: 21.8, north: 26.4 };

export async function loadCounties(url = "/static/geo/taiwan-counties.json") {
  const geojson = await (await fetch(url)).json();
  return geojson.features.map((feature) => {
    const polygons = feature.geometry.coordinates;
    let west = Infinity; let east = -Infinity; let south = Infinity; let north = -Infinity;
    for (const polygon of polygons) {
      for (const [lon, lat] of polygon[0]) {
        west = Math.min(west, lon); east = Math.max(east, lon);
        south = Math.min(south, lat); north = Math.max(north, lat);
      }
    }
    return { name: feature.properties.name, polygons, bbox: { west, east, south, north } };
  });
}

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The county containing a point, or null. Holes (a city inside a county) count as outside. */
export function countyAt(counties, lon, lat) {
  for (const county of counties) {
    const b = county.bbox;
    if (lon < b.west || lon > b.east || lat < b.south || lat > b.north) continue;
    for (const polygon of county.polygons) {
      if (!inRing(lon, lat, polygon[0])) continue;
      if (!polygon.slice(1).some((hole) => inRing(lon, lat, hole))) return county.name;
    }
  }
  return null;
}

// A canvas in plate carrée over `bounds`, at most `maxSide` pixels on its longer edge.
export function geoCanvas(bounds, maxSide) {
  const spanX = bounds.east - bounds.west;
  const spanY = bounds.north - bounds.south;
  const scale = maxSide / Math.max(spanX, spanY);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(spanX * scale);
  canvas.height = Math.round(spanY * scale);
  const project = ([lon, lat]) => [(lon - bounds.west) * scale, (bounds.north - lat) * scale];
  return { canvas, context: canvas.getContext("2d"), project };
}

function tracePolygons(context, project, polygons) {
  context.beginPath();
  for (const polygon of polygons) {
    for (const ring of polygon) {
      ring.forEach((point, index) => {
        const [x, y] = project(point);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
    }
  }
}

/** Every county border as thin light lines on a transparent canvas. `scale` thickens them. */
export function bordersCanvas(counties, maxSide = 4096, scale = 1) {
  const { canvas, context, project } = geoCanvas(BOUNDS, maxSide);
  context.lineJoin = "round";
  context.lineCap = "round";
  // A dark under-stroke keeps the line readable over bright imagery.
  // Lines are drawn wide enough to survive the downsampling of a far view.
  for (const [width, color] of [[4.6, "rgba(8, 12, 28, 0.32)"], [2.2, "rgba(255, 255, 255, 0.8)"]]) {
    context.lineWidth = width * scale;
    context.strokeStyle = color;
    for (const county of counties) {
      tracePolygons(context, project, county.polygons);
      context.stroke();
    }
  }
  return canvas;
}

/** One county's outline, glowing, at high resolution over its own bounding box. */
export function highlightCanvas(county, maxSide = 1400) {
  const pad = 0.03;
  const bounds = {
    west: county.bbox.west - pad, east: county.bbox.east + pad,
    south: county.bbox.south - pad, north: county.bbox.north + pad,
  };
  const { canvas, context, project } = geoCanvas(bounds, maxSide);
  tracePolygons(context, project, county.polygons);
  context.fillStyle = "rgba(255, 255, 255, 0.08)";
  context.fill("evenodd");
  context.lineJoin = "round";
  context.shadowColor = "rgba(253, 224, 71, 0.9)";
  context.shadowBlur = 14;
  context.lineWidth = 4;
  context.strokeStyle = "rgba(254, 240, 138, 0.95)";
  context.stroke();
  context.shadowBlur = 0;
  context.lineWidth = 1.6;
  context.strokeStyle = "#fffbeb";
  context.stroke();
  return { canvas, bounds };
}

/** Land pixels of a width×height grid over BOUNDS, as a Uint8Array mask. */
export function landMask(counties, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const project = ([lon, lat]) => [
    ((lon - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * width,
    ((BOUNDS.north - lat) / (BOUNDS.north - BOUNDS.south)) * height,
  ];
  context.fillStyle = "#fff";
  for (const county of counties) {
    tracePolygons(context, project, county.polygons);
    context.fill("evenodd");
  }
  const pixels = context.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) mask[i] = pixels[i * 4 + 3];
  return mask;
}
