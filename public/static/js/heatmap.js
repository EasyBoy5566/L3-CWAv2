// A temperature field from station readings, painted over land only.
//
// Inverse-distance weighting with power 2: each land cell takes a weighted
// mean of every station, weighted by 1/d². A small smoothing distance keeps
// single stations from punching bull's-eyes into the field. Distances use a
// cos(latitude) factor so a degree of longitude is not treated as a degree
// of latitude.
import { BOUNDS, landMask } from "./geo.js";
import { TEMPERATURE, colorAt } from "./scale.js";

const CELL = 0.006;          // degrees, about 650 m
const SMOOTH = 0.02 * 0.02;  // squared degrees added to every distance
const ALPHA = 0.72;

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

let maskCache = null;

export function heatmapCanvas(counties, stations) {
  const width = Math.round((BOUNDS.east - BOUNDS.west) / CELL);
  const height = Math.round((BOUNDS.north - BOUNDS.south) / CELL);
  if (!maskCache || maskCache.width !== width) maskCache = { width, mask: landMask(counties, width, height) };
  const { mask } = maskCache;

  const k = Math.cos((23.7 * Math.PI) / 180);
  const xs = Float64Array.from(stations, (s) => s.lon * k);
  const ys = Float64Array.from(stations, (s) => s.lat);
  const ts = Float64Array.from(stations, (s) => s.t);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const image = context.createImageData(width, height);
  const data = image.data;
  const lut = new Map();

  for (let row = 0; row < height; row += 1) {
    const lat = BOUNDS.north - (row + 0.5) * CELL;
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      const coverage = mask[index];
      if (!coverage) continue;
      const x = (BOUNDS.west + (col + 0.5) * CELL) * k;
      let sum = 0;
      let weights = 0;
      for (let s = 0; s < ts.length; s += 1) {
        const dx = xs[s] - x;
        const dy = ys[s] - lat;
        const w = 1 / (dx * dx + dy * dy + SMOOTH);
        sum += w * ts[s];
        weights += w;
      }
      // Tenths of a degree are plenty for colour; cache the lookups.
      const value = Math.round((sum / weights) * 10) / 10;
      let rgb = lut.get(value);
      if (!rgb) {
        rgb = hexToRgb(colorAt(TEMPERATURE, value));
        lut.set(value, rgb);
      }
      const o = index * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = Math.round(coverage * ALPHA);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}
