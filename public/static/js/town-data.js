// Everything known about one township, gathered from the overlay datasets.
//
// Each dataset is fetched once (the server and the edge cache it too), then
// indexed by county and township so a click resolves instantly. Stations are
// summarised per township: the wettest gauge, the range of temperatures, the
// strongest gust. UV has only a few dozen stations, so a township without one
// borrows the nearest in its county.
import { getJSON } from "./api.js";

export const SECTIONS = {
  forecast: { source: "townships", label: "鄉鎮預報" },
  heat: { source: "heat", label: "熱傷害指數" },
  rain: { source: "rain", label: "雨量站" },
  stations: { source: "stations", label: "氣象站觀測" },
  uv: { source: "uv", label: "紫外線" },
};

const FRESH_MS = 5 * 60 * 1000;
const key = (county, town) => `${county}|${town}`;

function index(rows) {
  const byTown = new Map();
  for (const row of rows) {
    const k = key(row.county, row.town);
    if (!byTown.has(k)) byTown.set(k, []);
    byTown.get(k).push(row);
  }
  return byTown;
}

const distance = (a, [lon, lat]) => (a.lon - lon) ** 2 + ((a.lat - lat) * 1.1) ** 2;

export class TownData {
  constructor() {
    this.loaded = new Map(); // source → { at, promise }
  }

  load(source) {
    const hit = this.loaded.get(source);
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.promise;
    const entry = { at: Date.now(), promise: null, settled: null };
    entry.promise = getJSON(`/api/overlays/${source}`).then((data) => {
      const rows = data.towns ?? data.stations ?? [];
      entry.settled = { data, byTown: index(rows) };
      return entry.settled;
    });
    // A failed fetch is not cached, so the next click retries.
    entry.promise.catch(() => {
      if (this.loaded.get(source) === entry) this.loaded.delete(source);
    });
    this.loaded.set(source, entry);
    return entry.promise;
  }

  /** Just the township forecast, for the hover card; null until it has loaded once. */
  peekForecast(county, town) {
    const hit = this.loaded.get("townships");
    return hit?.settled?.byTown.get(key(county, town))?.[0] ?? null;
  }

  async forTown(town, sections) {
    const result = {};
    await Promise.all(sections.map(async (section) => {
      const source = SECTIONS[section]?.source;
      if (!source) return;
      try {
        const loaded = await this.load(source);
        const rows = loaded.byTown.get(key(town.county, town.town)) ?? [];
        result[section] = summarise(section, rows, loaded, town);
      } catch (error) {
        result[section] = { error: error.message };
      }
    }));
    return result;
  }
}

function summarise(section, rows, loaded, town) {
  switch (section) {
    case "forecast":
    case "heat":
      return { row: rows[0] ?? null };
    case "rain": {
      if (!rows.length) return { count: 0 };
      const wettest = rows.reduce((a, b) => ((b.r24h ?? -1) > (a.r24h ?? -1) ? b : a));
      const max = (field) => Math.max(...rows.map((r) => r[field] ?? 0));
      return { count: rows.length, r10m: max("r10m"), r1h: max("r1h"), r24h: max("r24h"), r3d: max("r3d"), wettest, time: rows[0].time };
    }
    case "stations": {
      const reporting = rows.filter((r) => r.t !== null);
      if (!reporting.length) return { count: rows.length, list: [] };
      const temperatures = reporting.map((r) => r.t);
      const humidities = reporting.map((r) => r.rh).filter((v) => v !== null).sort((a, b) => a - b);
      const gusts = rows.map((r) => r.gust).filter((v) => v !== null);
      return {
        count: rows.length,
        tmin: Math.min(...temperatures),
        tmax: Math.max(...temperatures),
        rh: humidities.length ? humidities[Math.floor(humidities.length / 2)] : null,
        gust: gusts.length ? Math.max(...gusts) : null,
        list: [...reporting].sort((a, b) => (a.alt ?? 0) - (b.alt ?? 0)).slice(0, 6),
        time: reporting[0].time,
      };
    }
    case "uv": {
      if (rows.length) return { row: rows[0], borrowed: false, date: loaded.data.date };
      const inCounty = loaded.data.stations.filter((s) => s.county === town.county);
      if (!inCounty.length) return { row: null, date: loaded.data.date };
      const nearest = inCounty.reduce((a, b) => (distance(b, town.center) < distance(a, town.center) ? b : a));
      return { row: nearest, borrowed: true, date: loaded.data.date };
    }
    default:
      return null;
  }
}
